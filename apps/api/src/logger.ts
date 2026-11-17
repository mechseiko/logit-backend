import pino from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.intake',
        'req.body.studentDetails',
        'req.body.password',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    base: { service: 'logit-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
