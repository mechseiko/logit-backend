import { promises as fs } from 'node:fs';
import path from 'node:path';

export type WhereOp = '==' | '!=' | '>' | '>=' | '<' | '<=';
export type WhereClause = [field: string, op: WhereOp, value: unknown];
export interface QuerySpec {
  where?: WhereClause[];
  orderBy?: [field: string, direction: 'asc' | 'desc'][];
  limit?: number;
}

export interface StoreTx {
  get<T>(docPath: string): Promise<T | null>;
  set<T extends object>(docPath: string, data: T): Promise<void>;
  merge<T extends object>(docPath: string, patch: Partial<T>): Promise<void>;
  delete(docPath: string): Promise<void>;
  add<T extends object>(collection: string, data: T): Promise<string>;
}

export interface Store extends StoreTx {
  query<T>(collection: string, spec?: QuerySpec): Promise<T[]>;
  count(collection: string, spec?: QuerySpec): Promise<number>;
  /** Deletes a document and everything beneath it. */
  deleteTree(docPath: string): Promise<void>;
  /** Serialised read-modify-write used for money and queue state. */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  flush?(): Promise<void>;
}

function normalise(docPath: string): string {
  return docPath.replace(/^\/+|\/+$/g, '');
}

function readField(data: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function matches(data: Record<string, unknown>, clause: WhereClause): boolean {
  const [field, op, expected] = clause;
  const actual = readField(data, field);
  switch (op) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return compareValues(actual, expected) > 0;
    case '>=':
      return compareValues(actual, expected) >= 0;
    case '<':
      return compareValues(actual, expected) < 0;
    case '<=':
      return compareValues(actual, expected) <= 0;
    default:
      return false;
  }
}

export interface MemoryStoreOptions {
  /** JSON snapshot file. When omitted the store is process-memory only (tests). */
  filePath?: string;
}

/**
 * Local/development store. Also used by every test: fast, deterministic and needs no emulator.
 * Writes are serialised behind a promise chain so transactions behave predictably.
 */
export class MemoryStore implements Store {
  private docs = new Map<string, Record<string, unknown>>();
  private lock: Promise<unknown> = Promise.resolve();
  private saveTimer: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(private readonly options: MemoryStoreOptions = {}) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.options.filePath) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.options.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { docs?: [string, Record<string, unknown>][] };
      for (const [key, value] of parsed.docs ?? []) this.docs.set(key, value);
    } catch {
      // A missing or unreadable snapshot just means an empty database.
    }
  }

  private scheduleSave(): void {
    if (!this.options.filePath) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 150);
  }

  async flush(): Promise<void> {
    if (!this.options.filePath) return;
    const payload = JSON.stringify({ docs: [...this.docs.entries()] });
    await fs.mkdir(path.dirname(this.options.filePath), { recursive: true });
    await fs.writeFile(this.options.filePath, payload, 'utf8');
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = async () => fn();
    const next = this.lock.then(run, run);
    this.lock = next.catch(() => undefined);
    return next;
  }

  async get<T>(docPath: string): Promise<T | null> {
    await this.ensureLoaded();
    const value = this.docs.get(normalise(docPath));
    return value ? (structuredClone(value) as T) : null;
  }

  async set<T extends object>(docPath: string, data: T): Promise<void> {
    await this.ensureLoaded();
    await this.withLock(() => {
      this.docs.set(normalise(docPath), structuredClone(data) as Record<string, unknown>);
      this.scheduleSave();
    });
  }

  async merge<T extends object>(docPath: string, patch: Partial<T>): Promise<void> {
    await this.ensureLoaded();
    await this.withLock(() => {
      const key = normalise(docPath);
      const current = this.docs.get(key) ?? {};
      this.docs.set(key, { ...current, ...(structuredClone(patch) as Record<string, unknown>) });
      this.scheduleSave();
    });
  }

  async delete(docPath: string): Promise<void> {
    await this.ensureLoaded();
    await this.withLock(() => {
      this.docs.delete(normalise(docPath));
      this.scheduleSave();
    });
  }

  async add<T extends object>(collection: string, data: T): Promise<string> {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await this.set(`${normalise(collection)}/${id}`, data);
    return id;
  }

  async query<T>(collection: string, spec: QuerySpec = {}): Promise<T[]> {
    await this.ensureLoaded();
    const prefix = `${normalise(collection)}/`;
    const rows: { key: string; data: Record<string, unknown> }[] = [];
    for (const [key, data] of this.docs) {
      if (!key.startsWith(prefix)) continue;
      if (key.slice(prefix.length).includes('/')) continue;
      if (spec.where?.every((clause) => matches(data, clause)) ?? true) rows.push({ key, data });
    }
    for (const [field, direction] of [...(spec.orderBy ?? [])].reverse()) {
      rows.sort((a, b) => {
        const result = compareValues(readField(a.data, field), readField(b.data, field));
        return direction === 'desc' ? -result : result;
      });
    }
    const limited = spec.limit ? rows.slice(0, spec.limit) : rows;
    return limited.map((row) => structuredClone(row.data) as T);
  }

  async count(collection: string, spec: QuerySpec = {}): Promise<number> {
    return (await this.query(collection, { ...spec, limit: undefined })).length;
  }

  async deleteTree(docPath: string): Promise<void> {
    await this.ensureLoaded();
    const target = normalise(docPath);
    await this.withLock(() => {
      for (const key of [...this.docs.keys()]) {
        if (key === target || key.startsWith(`${target}/`)) this.docs.delete(key);
      }
      this.scheduleSave();
    });
  }

  private readRaw<T>(docPath: string): T | null {
    const value = this.docs.get(normalise(docPath));
    return value ? (structuredClone(value) as T) : null;
  }

  private writeRaw(docPath: string, data: Record<string, unknown>): void {
    this.docs.set(normalise(docPath), structuredClone(data));
  }

  /**
   * Serialised read-modify-write. The callback must use the given tx handle only;
   * the store's own write methods take the same lock and would deadlock.
   */
  async transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    await this.ensureLoaded();
    return this.withLock(async () => {
      const tx: StoreTx = {
        get: async <V>(docPath: string) => this.readRaw<V>(docPath),
        set: async <V extends object>(docPath: string, data: V) => {
          this.writeRaw(docPath, data as Record<string, unknown>);
        },
        merge: async <V extends object>(docPath: string, patch: Partial<V>) => {
          const current = this.readRaw<Record<string, unknown>>(docPath) ?? {};
          this.writeRaw(docPath, { ...current, ...(patch as Record<string, unknown>) });
        },
        delete: async (docPath: string) => {
          this.docs.delete(normalise(docPath));
        },
        add: async <V extends object>(collection: string, data: V) => {
          const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          this.writeRaw(`${normalise(collection)}/${id}`, data as Record<string, unknown>);
          return id;
        },
      };
      const result = await fn(tx);
      this.scheduleSave();
      return result;
    });
  }

  /** Test helper. */
  reset(): void {
    this.docs.clear();
  }
}
