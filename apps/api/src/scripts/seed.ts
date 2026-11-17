import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { createStore } from '../db/index.js';
import { ensureSchoolSeed } from '../services/schools.js';

const logger = createLogger(config);
const store = await createStore(config);

const schools = await ensureSchoolSeed(store);
await store.flush?.();

logger.info({ schools, store: config.storeDriver }, 'seed complete');
