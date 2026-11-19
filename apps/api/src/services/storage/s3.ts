import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PutResult, SignedUpload, StorageAdapter } from './types.js';
import { safeFileName } from './signing.js';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Production storage: Cloudflare R2 (S3 compatible) or MinIO locally. */
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, bytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Missing object ${key}`);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of listed.Contents ?? []) {
        if (!object.Key) continue;
        await this.delete(object.Key);
        removed += 1;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async usedBytes(prefix: string): Promise<number> {
    let total = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of listed.Contents ?? []) total += object.Size ?? 0;
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return total;
  }

  async signedGetUrl(key: string, downloadName?: string, ttlSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadName
        ? { ResponseContentDisposition: `attachment; filename="${safeFileName(downloadName)}"` }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async signedPutUrl(
    key: string,
    contentType: string,
    _maxBytes: number,
    ttlSeconds = 900,
  ): Promise<SignedUpload> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
    return { url, method: 'PUT', headers: { 'content-type': contentType } };
  }

  /**
   * Write → read → delete a probe object. This proves the credentials and bucket policy allow the
   * server-side operations an upload depends on; it cannot prove the browser's CORS rules, which
   * the upload page checks from the origin itself.
   */
  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const key = `health/probe-${Date.now().toString(36)}.txt`;
    try {
      await this.put(key, Buffer.from('ok', 'utf8'), 'text/plain');
      const bytes = await this.get(key);
      await this.delete(key);
      return { ok: bytes.toString('utf8') === 'ok', detail: 'bucket write, read and delete succeeded' };
    } catch (error) {
      await this.delete(key).catch(() => undefined);
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'storage request failed',
      };
    }
  }
}
