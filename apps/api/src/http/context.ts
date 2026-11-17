import type { UserProfile } from '@logit/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth.js';
import { unauthorized } from '../errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      profile?: UserProfile;
      requestId?: string;
    }
  }
}

export function requireAuthUser(req: Request): AuthUser {
  if (!req.authUser) throw unauthorized();
  return req.authUser;
}

export function requireProfile(req: Request): UserProfile {
  if (!req.profile) throw unauthorized('Finish creating your account first.');
  return req.profile;
}

export function optionalProfile(req: Request): UserProfile | undefined {
  return req.profile;
}
