import type { ErrorCode } from '@logit/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION', message, details);
export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this.') =>
  new ApiError(403, 'FORBIDDEN', message);
export const banned = () => new ApiError(403, 'BANNED', 'This account is blocked. Contact support.');
export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, 'CONFLICT', message, details);
export const insufficientCredits = (needed: number, balance: number) =>
  new ApiError(
    402,
    'INSUFFICIENT_CREDITS',
    `You need ${needed} credits but have ${balance}. Top up to continue.`,
    { needed, balance },
  );
export const rateLimited = (message = 'Too many requests. Try again shortly.') =>
  new ApiError(429, 'RATE_LIMITED', message);
export const limitReached = (message: string) => new ApiError(429, 'LIMIT_REACHED', message);

export const retryableCodes: ErrorCode[] = ['PROCESSING_FAILED', 'AI_UNAVAILABLE', 'INTERNAL'];
