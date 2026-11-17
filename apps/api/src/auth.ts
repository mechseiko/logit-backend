import type { AppConfig } from './config.js';
import { unauthorized } from './errors.js';

export interface AuthUser {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}

interface FirebaseAppLike {
  name: string;
}

let firebaseApp: FirebaseAppLike | null = null;

async function firebaseAuth(serviceAccountJson: string) {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  if (!firebaseApp) {
    firebaseApp =
      getApps()[0] ??
      initializeApp({
        credential: cert(JSON.parse(serviceAccountJson) as Record<string, string>),
      });
  }
  return getAuth(firebaseApp as never);
}

function parseDevToken(token: string): AuthUser {
  if (!token.startsWith('dev.')) throw unauthorized();
  try {
    const payload = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8')) as {
      uid?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    const email = (payload.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw unauthorized('The dev sign-in email is invalid.');
    const uid = payload.uid ?? `dev_${Buffer.from(email).toString('base64url').slice(0, 20)}`;
    return { uid, email, name: payload.name, picture: payload.picture };
  } catch {
    throw unauthorized('The dev sign-in token is invalid.');
  }
}

export async function verifyToken(token: string, config: AppConfig): Promise<AuthUser> {
  if (!token) throw unauthorized();
  if (config.authMode === 'dev') return parseDevToken(token);
  if (!config.firebaseServiceAccountJson) {
    throw unauthorized('Firebase is not configured on the server.');
  }
  try {
    const auth = await firebaseAuth(config.firebaseServiceAccountJson);
    const decoded = await auth.verifyIdToken(token);
    if (!decoded.email) throw unauthorized('Use a Google account with an email address.');
    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      picture: typeof decoded.picture === 'string' ? decoded.picture : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'ApiError') throw error;
    throw unauthorized('Your session expired. Sign in again.');
  }
}

/** Creates the dev sign-in token the web app uses when Firebase is not configured. */
export function createDevToken(email: string, name?: string): string {
  const payload = { email: email.trim().toLowerCase(), name, uid: undefined };
  return `dev.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

/**
 * Deletes the Firebase Auth identity when the API runs against real Firebase.
 * Dev mode has no identity to remove, so it is a no-op.
 */
export async function deleteFirebaseUser(uid: string, config: AppConfig): Promise<void> {
  if (config.authMode !== 'firebase' || !config.firebaseServiceAccountJson) return;
  const auth = await firebaseAuth(config.firebaseServiceAccountJson);
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'auth/user-not-found') return;
    throw error;
  }
}
