import { GoogleGenAI } from '@google/genai';
import type { ReportFacts, ReportOutput } from '@logit/shared';
import type { AiProvider, SafeContext, WeekInput, WeekOutput } from './types.js';
import { buildChatPrompt, buildReportPrompt, buildShortenPrompt, buildWeekPrompt } from './prompts.js';

/** Minimal surface of the official SDK, so contract tests can inject a recorder. */
export interface GeminiClientLike {
  models: {
    generateContent(args: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly client: GeminiClientLike;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: GeminiClientLike,
  ) {
    this.client = client ?? (new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike);
  }

  private async complete(prompt: string, json: boolean): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: json ? 0.8 : 0.5,
        maxOutputTokens: 2048,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
    return (response.text ?? '').trim();
  }

  private parseJson(raw: string): unknown {
    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error('The AI returned text that is not JSON.');
    }
  }

  async generateWeek(input: WeekInput): Promise<WeekOutput> {
    const raw = await this.complete(buildWeekPrompt(input), true);
    return this.parseJson(raw) as WeekOutput;
  }

  async generateReport(input: ReportFacts): Promise<ReportOutput> {
    const raw = await this.complete(buildReportPrompt(input), true);
    return this.parseJson(raw) as ReportOutput;
  }

  async shorten(input: { text: string; maxChars: number }): Promise<string> {
    const raw = await this.complete(buildShortenPrompt(input.text, input.maxChars), false);
    return raw.replace(/^["']|["']$/g, '').trim();
  }

  async chat(input: { context: SafeContext; message: string }): Promise<string> {
    return this.complete(buildChatPrompt(input.context, input.message), false);
  }
}
