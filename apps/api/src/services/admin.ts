import { randomBytes } from 'node:crypto';
import { type Job, type LedgerEntry, type PaymentRecord, type UserProfile } from '@logit/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import { badRequest, notFound } from '../errors.js';
import type { GenerationService } from './generation.js';
import type { PaymentsService } from './payments/index.js';
import type { StorageAdapter } from './storage/index.js';

export interface AuditEntry {
  id?: string;
  adminUid: string;
  action: string;
  target: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface AdminStats {
  users: number;
  onboarded: number;
  banned: number;
  jobsByStatus: Record<string, number>;
  jobsTotal: number;
  revenueNaira: number;
  creditsOutstanding: number;
  storageUsedBytes: number;
  openTemplateRequests: number;
  openSchoolRequests: number;
}

export class AdminService {
  constructor(
    private readonly store: Store,
    private readonly generation: GenerationService,
    private readonly payments: PaymentsService,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
  ) {}

  private async audit(
    adminUid: string,
    action: string,
    target: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const entry: AuditEntry = {
      adminUid,
      action,
      target,
      details,
      createdAt: new Date().toISOString(),
    };
    await this.store.add('auditLogs', entry);
  }

  async stats(): Promise<AdminStats> {
    const [users, jobs, payments, requests, schoolRequests] = await Promise.all([
      this.store.query<UserProfile>('users', {}),
      this.store.query<Job>('jobs', {}),
      this.store.query<PaymentRecord>('payments', { where: [['status', '==', 'success']] }),
      this.store.query('templateRequests', { where: [['status', '==', 'open']] }),
      this.store.query('schoolRequests', { where: [['status', '==', 'open']] }),
    ]);
    const jobsByStatus: Record<string, number> = {};
    for (const job of jobs) jobsByStatus[job.status] = (jobsByStatus[job.status] ?? 0) + 1;
    return {
      users: users.length,
      onboarded: users.filter((user) => user.onboardingDone).length,
      banned: users.filter((user) => user.banned).length,
      jobsByStatus,
      jobsTotal: jobs.length,
      revenueNaira: payments.reduce((sum, payment) => sum + payment.naira, 0),
      creditsOutstanding: users.reduce((sum, user) => sum + user.balance + user.reserved, 0),
      storageUsedBytes: await this.storage.usedBytes(''),
      openTemplateRequests: requests.length,
      openSchoolRequests: schoolRequests.length,
    };
  }

  async users(query: string, limit = 50): Promise<UserProfile[]> {
    const users = await this.store.query<UserProfile>('users', {});
    const q = query.trim().toLowerCase();
    return users
      .filter(
        (user) =>
          !q ||
          user.email.toLowerCase().includes(q) ||
          user.displayName.toLowerCase().includes(q) ||
          user.uid.toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async user(uid: string): Promise<{
    user: UserProfile;
    jobs: Job[];
    payments: PaymentRecord[];
    ledger: LedgerEntry[];
    isAdmin: boolean;
  }> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('User not found.');
    const [jobs, payments, ledger] = await Promise.all([
      this.store.query<Job>('jobs', { where: [['uid', '==', uid]], orderBy: [['createdAt', 'desc']] }),
      this.store.query<PaymentRecord>('payments', {
        where: [['uid', '==', uid]],
        orderBy: [['createdAt', 'desc']],
      }),
      this.store.query<LedgerEntry>('creditLedger', {
        where: [['uid', '==', uid]],
        orderBy: [['createdAt', 'desc']],
        limit: 100,
      }),
    ]);
    const ownerEmail = user.email.toLowerCase() === this.config.adminBootstrapEmail?.toLowerCase();
    return { user, jobs, payments, ledger, isAdmin: user.admin === true && ownerEmail };
  }

  async adjust(uid: string, amount: number, reason: string, adminUid: string): Promise<UserProfile> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('User not found.');
    const { CreditsService } = await import('./credits.js');
    const credits = new CreditsService(this.store);
    await credits.adjust(uid, amount, reason);
    await this.audit(adminUid, 'user.adjust', uid, { amount, reason });
    return (await this.store.get<UserProfile>(`users/${uid}`))!;
  }

  async setBanned(
    uid: string,
    isBanned: boolean,
    reason: string,
    adminUid: string,
  ): Promise<UserProfile> {
    const user = await this.store.get<UserProfile>(`users/${uid}`);
    if (!user) throw notFound('User not found.');
    if (uid === adminUid) throw badRequest('You cannot ban your own admin account.');
    await this.store.merge(`users/${uid}`, { banned: isBanned });
    await this.audit(adminUid, isBanned ? 'user.ban' : 'user.unban', uid, { reason });
    return (await this.store.get<UserProfile>(`users/${uid}`))!;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    return this.store.query<PaymentRecord>('payments', {
      orderBy: [['createdAt', 'desc']],
      limit: 200,
    });
  }

  async reconcile(reference: string, adminUid: string): Promise<{ status: string; credits: number }> {
    const result = await this.payments.settle(reference);
    await this.audit(adminUid, 'payment.reconcile', reference, { status: result.status });
    return { status: result.status, credits: result.credits };
  }

  async listJobs(status?: string): Promise<Job[]> {
    const jobs = await this.store.query<Job>('jobs', {
      ...(status ? { where: [['status', '==', status]] } : {}),
      orderBy: [['updatedAt', 'desc']],
      limit: 100,
    });
    return jobs;
  }

  async retryJob(jobId: string, adminUid: string): Promise<Job> {
    const job = await this.store.get<Job>(`jobs/${jobId}`);
    if (!job) throw notFound('Job not found.');
    if (job.status !== 'failed') throw badRequest('Only failed jobs can be retried.');
    if (job.normalized) {
      await this.store.merge(`jobs/${jobId}`, { status: 'ready_to_generate', error: undefined });
      await this.generation.start(job.uid, jobId, true);
    } else {
      await this.store.merge(`jobs/${jobId}`, {
        status: 'queued',
        queue: { state: 'queued', kind: 'ingest', attempts: 0 },
        error: undefined,
      });
    }
    await this.audit(adminUid, 'job.retry', jobId, { previousStatus: job.status });
    return (await this.store.get<Job>(`jobs/${jobId}`))!;
  }

  async templateRequests(): Promise<
    { id: string; uid: string; jobId: string; programme: string; schoolId: string; createdAt: string; status: string; imageUrl: string }[]
  > {
    const requests = await this.store.query<{
      id: string;
      uid: string;
      jobId: string;
      programme: string;
      schoolId: string;
      createdAt: string;
      status: string;
      pageImageKey: string;
    }>('templateRequests', {});
    const out = [];
    for (const request of requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      let imageUrl = '';
      try {
        imageUrl = await this.storage.signedGetUrl(request.pageImageKey, 'page1.png');
      } catch {
        imageUrl = '';
      }
      out.push({ ...request, imageUrl });
    }
    return out;
  }

  async resolveTemplateRequest(
    id: string,
    input: { templateId?: string; reject?: boolean },
    adminUid: string,
  ): Promise<void> {
    const request = await this.store.get<{ pageImageKey: string; status: string }>(
      `templateRequests/${id}`,
    );
    if (!request) throw notFound('Request not found.');
    if (request.status !== 'open') throw badRequest('This request is already resolved.');
    await this.store.merge(`templateRequests/${id}`, {
      status: input.reject ? 'rejected' : 'resolved',
      resolvedTemplateId: input.templateId ?? null,
      resolvedAt: new Date().toISOString(),
    });
    await this.storage.delete(request.pageImageKey).catch(() => undefined);
    await this.audit(adminUid, input.reject ? 'templateRequest.reject' : 'templateRequest.resolve', id, {
      templateId: input.templateId,
    });
  }

  async schoolRequests(): Promise<{ id: string; name: string; uid: string; createdAt: string }[]> {
    return this.store.query('schoolRequests', { orderBy: [['createdAt', 'desc']], limit: 100 });
  }

  async resolveSchoolRequest(
    id: string,
    action: 'added' | 'rejected',
    adminUid: string,
  ): Promise<void> {
    await this.store.merge(`schoolRequests/${id}`, { status: action });
    await this.audit(adminUid, `schoolRequest.${action}`, id);
  }

  async auditLog(limit = 200): Promise<AuditEntry[]> {
    return this.store.query<AuditEntry>('auditLogs', {
      orderBy: [['createdAt', 'desc']],
      limit,
    });
  }

  async log(
    adminUid: string,
    action: string,
    target: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit(adminUid, action, target, details);
  }

  async ledgerCsv(): Promise<string> {
    const entries = await this.ledgerEntries(5000);
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = 'id,uid,type,amount,balanceAfter,reservedAfter,ref,note,createdAt';
    const rows = entries.map((entry) =>
      [
        entry.createdAt,
        entry.uid,
        entry.type,
        entry.amount,
        entry.balanceAfter,
        entry.reservedAfter,
        entry.ref,
        entry.note ?? '',
        entry.createdAt,
      ]
        .map(escape)
        .join(','),
    );
    return [header, ...rows].join('\n');
  }

  async ledgerEntries(limit = 200): Promise<LedgerEntry[]> {
    return this.store.query<LedgerEntry>('creditLedger', {
      orderBy: [['createdAt', 'desc']],
      limit,
    });
  }

  async recordReport(uid: string, jobId: string, message: string): Promise<void> {
    const id = `report_${randomBytes(5).toString('hex')}`;
    await this.store.set(`reports/${id}`, {
      id,
      uid,
      jobId,
      message: message.slice(0, 1000),
      createdAt: new Date().toISOString(),
      status: 'open',
    });
  }
}
