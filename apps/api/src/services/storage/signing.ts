import crypto from 'node:crypto';
import type { SignedUpload } from './types.js';

export interface FileTokenPayload {
  key: string;
  exp: number;
  name?: string;
  mime?: string;
  maxBytes?: number;
  mode: 'get' | 'put';
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signFileToken(payload: FileTokenPayload, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyFileToken(token: string, secret: string): FileTokenPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileTokenPayload;
    if (!payload.key || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function safeFileName(name: string, fallback = 'download.pdf'): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return cleaned || fallback;
}

export function proxyUploadUrl(
  apiPublicUrl: string,
  secret: string,
  payload: { key: string; mime: string; maxBytes: number; ttlSeconds?: number },
): SignedUpload {
  const token = signFileToken(
    {
      key: payload.key,
      exp: Date.now() + (payload.ttlSeconds ?? 900) * 1000,
      mode: 'put',
      mime: payload.mime,
      maxBytes: payload.maxBytes,
    },
    secret,
  );
  return {
    url: `${apiPublicUrl}/api/files/upload?token=${encodeURIComponent(token)}`,
    method: 'PUT',
    headers: { 'content-type': payload.mime },
  };
}
