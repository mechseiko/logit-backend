import path from 'node:path';
import type { AppConfig } from '../config.js';
import { MemoryStore, type Store } from './memoryStore.js';

export * from './memoryStore.js';

export async function createStore(config: AppConfig): Promise<Store> {
  if (config.isProd && config.storeDriver !== 'firestore') {
    throw new Error('STORE_DRIVER must be firestore in production.');
  }
  if (config.storeDriver === 'firestore') {
    if (!config.firebaseServiceAccountJson) {
      throw new Error('STORE_DRIVER=firestore needs FIREBASE_SERVICE_ACCOUNT_JSON.');
    }
    const { createFirestoreStore } = await import('./firestoreStore.js');
    return createFirestoreStore(config.firebaseServiceAccountJson);
  }
  return new MemoryStore({
    filePath: config.persistLocalStore ? path.join(config.dataDir, 'store.json') : undefined,
  });
}
