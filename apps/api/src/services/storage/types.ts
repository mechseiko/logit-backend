export interface PutResult {
  key: string;
  bytes: number;
}

export interface SignedUpload {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
}

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  /** Bytes used under a prefix (best effort for S3). */
  usedBytes(prefix: string): Promise<number>;
  /** Short-lived GET URL shown to the browser. */
  signedGetUrl(key: string, downloadName?: string, ttlSeconds?: number): Promise<string>;
  /** Short-lived PUT URL the browser uploads to. */
  signedPutUrl(key: string, contentType: string, maxBytes: number, ttlSeconds?: number): Promise<SignedUpload>;
}
