import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PutResult, SignedUpload, StorageAdapter } from './types.js';
import { signFileToken, safeFileName } from './signing.js';

export interface LocalStorageOptions {
  rootDir: string;
  publicUrl: string;
  secret: string;
}

/**
 * Filesystem storage used for local development and tests.
 * Presigned URLs point back at this API (PUT /api/files/upload/:token, GET /api/files?token=).
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;
  private readonly publicUrl: string;
  private readonly secret: string;

  constructor(options: LocalStorageOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.publicUrl = options.publicUrl.replace(/\/$/, '');
    this.secret = options.secret;
  }

  private fullPath(key: string): string {
    const cleaned = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const resolved = path.resolve(this.rootDir, cleaned);
    if (!resolved.startsWith(this.rootDir)) throw new Error(`Unsafe storage key: ${key}`);
    return resolved;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<PutResult> {
    const filePath = this.fullPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return { key, bytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.fullPath(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.fullPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const target = this.fullPath(prefix);
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          await fs.unlink(full).catch(() => undefined);
          removed += 1;
        }
      }
      await fs.rmdir(dir).catch(() => undefined);
    };
    await walk(target);
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.fullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async usedBytes(prefix: string): Promise<number> {
    const target = this.fullPath(prefix);
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const stat = await fs.stat(full).catch(() => null);
          total += stat?.size ?? 0;
        }
      }
    };
    await walk(target);
    return total;
  }

  async signedGetUrl(key: string, downloadName?: string, ttlSeconds = 900): Promise<string> {
    const token = signFileToken(
      {
        key,
        exp: Date.now() + ttlSeconds * 1000,
        mode: 'get',
        name: downloadName ? safeFileName(downloadName) : undefined,
      },
      this.secret,
    );
    return `${this.publicUrl}/api/files?token=${encodeURIComponent(token)}`;
  }

  async signedPutUrl(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds = 900,
  ): Promise<SignedUpload> {
    const token = signFileToken(
      { key, exp: Date.now() + ttlSeconds * 1000, mode: 'put', mime: contentType, maxBytes },
      this.secret,
    );
    return {
      url: `${this.publicUrl}/api/files/upload?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const key = `health/probe-${Date.now().toString(36)}.txt`;
    try {
      await this.put(key, Buffer.from('ok', 'utf8'), 'text/plain');
      const bytes = await this.get(key);
      await this.delete(key);
      return { ok: bytes.toString('utf8') === 'ok', detail: 'local storage write, read and delete succeeded' };
    } catch (error) {
      await this.delete(key).catch(() => undefined);
      return { ok: false, detail: error instanceof Error ? error.message : 'local storage failed' };
    }
  }
}
