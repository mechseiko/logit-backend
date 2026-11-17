import path from 'node:path';
import type { AppConfig } from '../../config.js';
import { LocalStorageAdapter } from './local.js';
import { S3StorageAdapter } from './s3.js';
import type { StorageAdapter } from './types.js';

export * from './types.js';
export * from './signing.js';

export function createStorage(config: AppConfig): StorageAdapter {
  if (config.isProd && config.storageDriver !== 's3') {
    throw new Error('STORAGE_DRIVER must be s3 in production.');
  }
  if (config.storageDriver === 's3') {
    return new S3StorageAdapter({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      bucket: config.s3.bucket,
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      forcePathStyle: config.s3.forcePathStyle,
    });
  }
  return new LocalStorageAdapter({
    rootDir: path.join(config.dataDir, 'storage'),
    publicUrl: config.apiPublicUrl,
    secret: config.devAuthSecret,
  });
}
