import { createHash, randomBytes } from 'node:crypto';
import { OWNER_ADMIN_EMAIL, type OnboardingInput } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { AuthUser } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { deleteFirebaseUser } from '../auth.js';
import type { StorageAdapter } from '../services/storage/index.js';
import type { UserProfile } from '@logit/shared';
import { getSchool } from './schools.js';

export interface BootstrapResult {
  user: UserProfile;
  isAdmin: boolean;
}

function referralCodeFrom(uid: string, salt = ''): string {
  return createHash('sha256')
    .update(`${uid}:${salt}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export class UsersService {
  constructor(
    private readonly store: Store,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  /** Production admin is hardcoded to the owner email; dev/tests may use ADMIN_BOOTSTRAP_EMAIL. */
  ownerEmail(): string {
    return this.config.isProd ? OWNER_ADMIN_EMAIL : this.config.adminBootstrapEmail;
  }

  isOwnerEmail(email: string | undefined): boolean {
    return (email ?? '').toLowerCase() === this.ownerEmail().toLowerCase();
  }

  async isAdmin(uid: string): Promise<boolean> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    return user?.admin === true && this.isOwnerEmail(user.email);
  }

  async bootstrap(authUser: AuthUser, referralCode?: string): Promise<BootstrapResult> {
    const existing = await this.store.get<UserProfile>(`users/${authUser.uid}`);
    let user = existing;
    if (!user) {
      let code = referralCodeFrom(authUser.uid);
      for (let i = 0; i < 5; i += 1) {
        const clash = await this.store.query<UserProfile>('users', {
          where: [['referralCode', '==', code]],
          limit: 1,
        });
        if (clash.length === 0) break;
        code = referralCodeFrom(authUser.uid, String(i + 1));
      }
      const now = this.now();
      user = {
        uid: authUser.uid,
        displayName: authUser.name ?? authUser.email.split('@')[0]!,
        email: authUser.email,
        photoURL: authUser.picture,
        onboardingDone: false,
        balance: 0,
        reserved: 0,
        referralCode: code,
        banned: false,
        createdAt: now,
        lastActiveAt: now,
        totalPaidNaira: 0,
      };
      await this.store.set(`users/${user.uid}`, user);
    } else {
      const patch: Partial<UserProfile> = { lastActiveAt: this.now() };
      if (authUser.name && authUser.name !== user.displayName) patch.displayName = authUser.name;
      if (authUser.picture && authUser.picture !== user.photoURL) patch.photoURL = authUser.picture;
      await this.store.merge(`users/${user.uid}`, patch);
      user = { ...user, ...patch };
    }

    if (user.banned) return { user, isAdmin: false };

    const isBootstrapAdmin = this.isOwnerEmail(user.email);
    if (isBootstrapAdmin && user.admin !== true) {
      await this.store.merge(`users/${user.uid}`, { admin: true });
      user = { ...user, admin: true };
    }

    if (referralCode && !user.referredBy && !user.onboardingDone) {
      await this.applyReferralCode(user, referralCode);
      user = (await this.store.get<UserProfile>(`users/${user.uid}`)) ?? user;
    }

    return { user, isAdmin: await this.isAdmin(user.uid) };
  }

  private async applyReferralCode(user: UserProfile, rawCode: string): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) return;
    const matches = await this.store.query<UserProfile>('users', {
      where: [['referralCode', '==', code]],
      limit: 1,
    });
    const referrer = matches[0];
    if (!referrer || referrer.uid === user.uid || referrer.banned) return;
    await this.store.set(`referrals/${user.uid}`, {
      referredUid: user.uid,
      referrerUid: referrer.uid,
      code,
      status: 'pending',
      createdAt: this.now(),
    });
    await this.store.merge(`users/${user.uid}`, { referredBy: referrer.uid });
  }

  async updateOnboarding(uid: string, input: OnboardingInput): Promise<UserProfile> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('Create your account first.');
    let schoolId = input.schoolId ?? '';
    let schoolName = '';
    if (input.schoolId) {
      const school = await getSchool(this.store, input.schoolId);
      if (!school) throw badRequest('Pick a school from the list.');
      schoolId = school.id;
      schoolName = school.name;
    } else if (input.otherSchoolName) {
      const requestId = randomBytes(8).toString('hex');
      await this.store.set(`schoolRequests/${requestId}`, {
        id: requestId,
        uid,
        name: input.otherSchoolName,
        createdAt: this.now(),
        status: 'open',
      });
      schoolId = '';
      schoolName = input.otherSchoolName;
    }
    const patch: Partial<UserProfile> = {
      schoolId: schoolId || undefined,
      schoolName,
      department: input.department,
      programme: input.programme,
      level: input.level,
      onboardingDone: true,
      consent: { version: input.consent.version, at: this.now(), over18: input.consent.over18 },
      lastActiveAt: this.now(),
    };
    await this.store.merge(`users/${uid}`, patch);
    return (await this.store.get<UserProfile>(`users/${uid}`))!;
  }

  async getProfile(uid: string): Promise<UserProfile> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('Account not found.');
    return user;
  }

  async updateProfile(
    uid: string,
    patch: Partial<Pick<UserProfile, 'displayName' | 'department' | 'level' | 'programme' | 'schoolId'>>,
  ): Promise<UserProfile> {
    const user = await this.getProfile(uid);
    const next: Partial<UserProfile> = { ...patch, lastActiveAt: this.now() };
    if (patch.schoolId) {
      const school = await getSchool(this.store, patch.schoolId);
      if (!school) throw badRequest('That school does not exist.');
      next.schoolName = school.name;
    }
    await this.store.merge(`users/${uid}`, next);
    return { ...user, ...next } as UserProfile;
  }

  async touch(uid: string): Promise<void> {
    await this.store.merge(`users/${uid}`, { lastActiveAt: this.now() });
  }

  /** Full deletion: Firestore documents and every stored object for the account. */
  async deleteAccount(uid: string): Promise<void> {
    await this.getProfile(uid);
    const jobs = await this.store.query<{ id: string }>('jobs', { where: [['uid', '==', uid]] });
    for (const job of jobs) {
      await this.store.deleteTree(`jobs/${job.id}`);
    }
    await Promise.all([
      this.storage.deletePrefix(`raw/${uid}`),
      this.storage.deletePrefix(`normalized/${uid}`),
      this.storage.deletePrefix(`thumbs/${uid}`),
      this.storage.deletePrefix(`outputs/${uid}`),
      this.storage.deletePrefix(`template-requests/${uid}`),
      this.storage.deletePrefix(`templates/${uid}`),
    ]);
    const ledger = await this.store.query<{ ref: string }>('creditLedger', { where: [['uid', '==', uid]] });
    for (const entry of ledger) await this.store.delete(`creditLedger/${entry.ref}`);
    const payments = await this.store.query<{ reference: string }>('payments', {
      where: [['uid', '==', uid]],
    });
    for (const payment of payments) await this.store.delete(`payments/${payment.reference}`);
    // Referrals where this user was the friend.
    await this.store.delete(`referrals/${uid}`);
    // Referrals where this user was the referrer are voided so the friend is not counted.
    const referred = await this.store.query<{ referredUid: string }>('referrals', {
      where: [['referrerUid', '==', uid]],
    });
    for (const entry of referred) {
      if (entry.referredUid) await this.store.merge(`referrals/${entry.referredUid}`, { status: 'void' });
    }
    const rates = await this.store.query<{ day?: string }>('rate', { where: [['uid', '==', uid]] });
    for (const rate of rates) {
      if (rate.day) await this.store.delete(`rate/${rate.day}`);
    }
    const reports = await this.store.query<{ id?: string }>('reports', { where: [['uid', '==', uid]] });
    for (const report of reports) {
      if (report.id) await this.store.delete(`reports/${report.id}`);
    }
    await this.store.delete(`users/${uid}`);
    await this.store.delete(`admins/${uid}`);

    // Production: remove the Firebase Auth identity too. Dev tokens have no identity.
    try {
      await deleteFirebaseUser(uid, this.config);
    } catch (error) {
      // Local data is already gone; surface the failure for admin follow-up without PII.
      console.error('Firebase Auth user deletion failed:', (error as Error).message);
    }
  }
}
