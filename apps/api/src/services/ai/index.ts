import type { AppConfig } from '../../config.js';
import { GeminiProvider } from './gemini.js';
import { MockAiProvider } from './mock.js';
import type { AiProvider } from './types.js';

export * from './types.js';
export * from './prompts.js';
export { generateValidatedWeek, generateValidatedReport } from './generate.js';
export { validateWeekOutput, validateReportOutput } from './validate.js';

export function createAiProvider(config: AppConfig): AiProvider {
  if (config.isProd && config.aiProvider !== 'gemini') {
    throw new Error('AI_PROVIDER must be gemini in production.');
  }
  if (config.aiProvider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('AI_PROVIDER=gemini needs GEMINI_API_KEY, or set AI_PROVIDER=mock.');
    }
    return new GeminiProvider(config.geminiApiKey, config.geminiModel);
  }
  return new MockAiProvider();
}
