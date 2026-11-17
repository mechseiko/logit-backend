import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { ApiError, badRequest, forbidden, unauthorized } from '../errors.js';
import type { Logger } from '../logger.js';
import { verifyToken } from '../auth.js';
import { requireAuthUser } from './context.js';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header('x-request-id') ?? crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** One structured line per request. URLs, methods and ids only — never bodies or PII. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - started,
        },
        'request',
      );
    });
    next();
  };
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw badRequest('Some fields need attention.', parsed.error.flatten());
  }
  return parsed.data;
}

export function authenticate(store: Store, config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) throw unauthorized();
        const authUser = await verifyToken(header.slice(7).trim(), config);
        req.authUser = authUser;
        const profile = await store.get<import('@logit/shared').UserProfile>(`users/${authUser.uid}`);
        if (profile?.banned) {
          throw new ApiError(403, 'BANNED', 'This account is blocked. Contact support.');
        }
        if (profile) req.profile = profile;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

export function requireAdmin(store: Store): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const user = requireAuthUser(req);
        const admin = await store.get<{ admin?: boolean }>(`admins/${user.uid}`);
        if (admin?.admin !== true) throw forbidden('Admins only.');
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
}

export function errorHandler(logger: Logger): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: { code: 'VALIDATION', message: 'Some fields need attention.', details: error.flatten() },
      });
      return;
    }
    const parserError = error as { type?: string; status?: number };
    if (parserError.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That request was too large.' } });
      return;
    }
    if (error instanceof SyntaxError && parserError.status === 400) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'The request body is not valid JSON.' } });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected error';
    logger.error({ err: error, requestId: req.requestId, path: req.path }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
    void message;
  };
}
