import {
  BUILTIN_PROFILES,
  type LogbookProfile,
  type Programme,
  validateProfile,
} from '@logit/shared';
import type { Store } from '../db/index.js';
import { badRequest, notFound } from '../errors.js';

/**
 * Logbook profiles: the structure a document is built for, per school and programme.
 *
 * Built-ins ship with the code (so OAU works the day we deploy), and an admin can add or edit
 * profiles without touching the repository. There is no box drawing and no fingerprint matching: a
 * profile answers "6 days a week, 12 weeks, monthly summary every 4, these labels".
 */
export class ProfilesService {
  constructor(private readonly store: Store) {}

  async listAll(): Promise<LogbookProfile[]> {
    const stored = await this.store.query<LogbookProfile>('profiles', {});
    const byId = new Map<string, LogbookProfile>();
    for (const profile of BUILTIN_PROFILES) byId.set(profile.id, profile);
    for (const profile of stored) byId.set(profile.id, profile);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listPublished(): Promise<LogbookProfile[]> {
    return (await this.listAll()).filter((profile) => profile.status === 'published');
  }

  async get(id: string): Promise<LogbookProfile | null> {
    const stored = await this.store.get<LogbookProfile>(`profiles/${id}`);
    if (stored) return stored;
    return BUILTIN_PROFILES.find((profile) => profile.id === id) ?? null;
  }

  async require(id: string): Promise<LogbookProfile> {
    const profile = await this.get(id);
    if (!profile) throw notFound('That logbook profile does not exist.');
    return profile;
  }

  /** The profile a school + programme resolves to. Always returns one. */
  async resolveFor(schoolId: string | undefined, programme: Programme): Promise<LogbookProfile> {
    const published = await this.listPublished();
    const exact = published.find(
      (profile) => profile.schoolIds.includes(schoolId ?? '') && profile.programmes.includes(programme),
    );
    if (exact) return exact;
    const anySchool = published.find(
      (profile) => profile.schoolIds.length === 0 && profile.programmes.includes(programme),
    );
    if (anySchool) return anySchool;
    return published[0] ?? BUILTIN_PROFILES[BUILTIN_PROFILES.length - 1]!;
  }

  async create(
    input: Omit<LogbookProfile, 'id' | 'source' | 'schoolIds' | 'status' | 'labels'> & {
      id?: string;
      schoolIds?: string[];
      status?: LogbookProfile['status'];
      labels?: LogbookProfile['labels'];
    },
  ): Promise<LogbookProfile> {
    const profile: LogbookProfile = {
      ...input,
      schoolIds: input.schoolIds ?? [],
      status: input.status ?? 'published',
      labels: input.labels ?? {
        weekly: 'Daily record of activities',
        monthly: 'Monthly summary of activities',
        summary: 'Weekly summary',
        supervisor: 'Supervisor’s remark, signature and company stamp',
      },
      id: input.id ?? `profile_${Date.now().toString(36)}`,
      source: 'admin',
    };
    const errors = validateProfile(profile);
    if (errors.length > 0) throw badRequest(errors[0]!, errors);
    await this.store.set(`profiles/${profile.id}`, profile);
    return profile;
  }

  async update(id: string, input: Partial<LogbookProfile>): Promise<LogbookProfile> {
    const existing = await this.get(id);
    if (!existing) throw notFound('That logbook profile does not exist.');
    const next: LogbookProfile = { ...existing, ...input, id, source: existing.source };
    const errors = validateProfile(next);
    if (errors.length > 0) throw badRequest(errors[0]!, errors);
    await this.store.set(`profiles/${id}`, next);
    return next;
  }

  async remove(id: string): Promise<void> {
    const profile = await this.get(id);
    if (!profile) throw notFound('That logbook profile does not exist.');
    if (profile.source === 'builtin') throw badRequest('Built-in profiles cannot be deleted.');
    await this.store.delete(`profiles/${id}`);
  }
}
