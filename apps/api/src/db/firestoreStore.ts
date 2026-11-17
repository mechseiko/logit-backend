import type {
  DocumentReference,
  Query as FirestoreQuery,
  Transaction as FirestoreTransaction,
  WhereFilterOp,
} from 'firebase-admin/firestore';
import type { QuerySpec, Store, StoreTx } from './memoryStore.js';

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = stripUndefined(entry);
    }
    return out as T;
  }
  return value;
}

async function deleteRecursive(ref: DocumentReference): Promise<void> {
  const collections = await ref.listCollections();
  for (const collection of collections) {
    const docs = await collection.listDocuments();
    for (const doc of docs) await deleteRecursive(doc);
  }
  await ref.delete();
}

export async function createFirestoreStore(serviceAccountJson: string): Promise<Store> {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const credentials = JSON.parse(serviceAccountJson) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key,
      }),
    });
  const db = getFirestore(app);

  const buildQuery = (collection: string, spec: QuerySpec = {}): FirestoreQuery => {
    let query: FirestoreQuery = db.collection(collection);
    for (const [field, op, value] of spec.where ?? []) {
      query = query.where(field, op as WhereFilterOp, value);
    }
    for (const [field, direction] of spec.orderBy ?? []) query = query.orderBy(field, direction);
    if (spec.limit) query = query.limit(spec.limit);
    return query;
  };

  const txFor = (tx: FirestoreTransaction): StoreTx => ({
    get: async <T>(docPath: string) => {
      const snap = await tx.get(db.doc(docPath));
      return snap.exists ? (snap.data() as T) : null;
    },
    set: async <T extends object>(docPath: string, data: T) => {
      tx.set(db.doc(docPath), stripUndefined(data));
    },
    merge: async <T extends object>(docPath: string, patch: Partial<T>) => {
      tx.set(db.doc(docPath), stripUndefined(patch), { merge: true });
    },
    delete: async (docPath: string) => {
      tx.delete(db.doc(docPath));
    },
    add: async <T extends object>(collection: string, data: T) => {
      const ref = db.collection(collection).doc();
      tx.set(ref, stripUndefined(data));
      return ref.id;
    },
  });

  return {
    async get<T>(docPath: string): Promise<T | null> {
      const snap = await db.doc(docPath).get();
      return snap.exists ? (snap.data() as T) : null;
    },
    async set<T extends object>(docPath: string, data: T): Promise<void> {
      await db.doc(docPath).set(stripUndefined(data));
    },
    async merge<T extends object>(docPath: string, patch: Partial<T>): Promise<void> {
      await db.doc(docPath).set(stripUndefined(patch), { merge: true });
    },
    async delete(docPath: string): Promise<void> {
      await db.doc(docPath).delete();
    },
    async add<T extends object>(collection: string, data: T): Promise<string> {
      const ref = await db.collection(collection).add(stripUndefined(data));
      return ref.id;
    },
    async query<T>(collection: string, spec: QuerySpec = {}): Promise<T[]> {
      const snap = await buildQuery(collection, spec).get();
      return snap.docs.map((doc) => doc.data() as T);
    },
    async count(collection: string, spec: QuerySpec = {}): Promise<number> {
      const snap = await buildQuery(collection, { ...spec, limit: undefined }).count().get();
      return snap.data().count;
    },
    async deleteTree(docPath: string): Promise<void> {
      await deleteRecursive(db.doc(docPath));
    },
    async transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
      return db.runTransaction(async (tx) => fn(txFor(tx)));
    },
  };
}
