import type { AppConfig } from '../config.js';
import type { Store } from '../db/index.js';
import type { Logger } from '../logger.js';
import { createAiProvider, type AiProvider } from './ai/index.js';
import { AdminService } from './admin.js';
import { CleanupService } from './cleanup.js';
import { CreditsService } from './credits.js';
import { ExportService } from './export.js';
import { GenerationService } from './generation.js';
import { IngestService } from './ingest.js';
import { JobsService } from './jobs.js';
import { createPaymentsProvider, PaymentsService } from './payments/index.js';
import { QueueService } from './queue.js';
import { ReferralsService } from './referrals.js';
import { ReportsService } from './reports.js';
import type { StorageAdapter } from './storage/index.js';
import { TemplatesService } from './templates.js';
import { ensureSchoolSeed } from './schools.js';
import { UsersService } from './users.js';

export interface Services {
  ai: AiProvider;
  users: UsersService;
  templates: TemplatesService;
  jobs: JobsService;
  ingest: IngestService;
  generation: GenerationService;
  export: ExportService;
  credits: CreditsService;
  referrals: ReferralsService;
  reports: ReportsService;
  payments: PaymentsService;
  admin: AdminService;
  queue: QueueService;
  cleanup: CleanupService;
}

export interface ServiceDeps {
  config: AppConfig;
  store: Store;
  storage: StorageAdapter;
  logger: Logger;
}

export async function buildServices(deps: ServiceDeps): Promise<Services> {
  const { config, store, storage, logger } = deps;
  await ensureSchoolSeed(store);

  const ai = createAiProvider(config);
  const users = new UsersService(store, storage, config);
  const templates = new TemplatesService(store, storage, config);
  const jobs = new JobsService(store, storage, config, templates);
  const ingest = new IngestService({ store, storage, config, templates });
  const generation = new GenerationService(store, ai, config, templates);
  const credits = new CreditsService(store);
  const referrals = new ReferralsService(store, config);
  const reports = new ReportsService(store, ai);
  const provider = createPaymentsProvider(store, config);
  const payments = new PaymentsService(store, provider, config, referrals);
  const exportService = new ExportService(store, storage, config, (text, maxChars) =>
    generation.shorten(text, maxChars),
  );
  const admin = new AdminService(store, generation, payments, storage, config);
  const queue = new QueueService(store, ingest, generation, config, logger);
  const cleanup = new CleanupService(store, storage, config, logger);

  return {
    ai,
    users,
    templates,
    jobs,
    ingest,
    generation,
    export: exportService,
    credits,
    referrals,
    reports,
    payments,
    admin,
    queue,
    cleanup,
  };
}
