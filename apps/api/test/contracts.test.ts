import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GeminiProvider, type GeminiClientLike } from '../src/services/ai/gemini.js';
import type { WeekInput } from '../src/services/ai/types.js';
import { PaystackProvider } from '../src/services/payments/paystack.js';
import { PaymentProviderError } from '../src/services/payments/types.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/recorded/${name}`, import.meta.url), 'utf8'));

interface RecordedCall {
  url: string;
  body?: string;
}

function recordingFetch(payload: unknown, status = 200) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const weekInput: WeekInput = {
  weekNumber: 2,
  programme: 'SIWES',
  department: 'Computer Science',
  company: 'Zenith Bank',
  unit: 'IT Support',
  tasks: [{ id: 'T1', text: 'Cable termination' }],
  tools: ['crimping tool'],
  skills: ['fault finding'],
  dates: [{ date: '2026-02-02', dayName: 'Monday' }],
  detail: 'standard',
  maxCharsPerEntry: 200,
};

describe('Paystack contract (recorded responses)', () => {
  it('initializes with the exact amount in kobo and parses the checkout URL', async () => {
    const { impl, calls } = recordingFetch(fixture('paystack-initialize.json'));
    const provider = new PaystackProvider('sk_test_fixture', impl);
    const result = await provider.initialize({
      reference: 'LGT_fixture_1',
      amountKobo: 100_000,
      email: 'student@test.local',
      callbackUrl: 'https://uselogit.cv/app/credits',
      metadata: { uid: 'uid_1' },
    });
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/fixture123');
    expect(calls[0]?.url).toContain('/transaction/initialize');
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    expect(sent.amount).toBe(100_000);
    expect(sent.reference).toBe('LGT_fixture_1');
    expect(sent.email).toBe('student@test.local');
  });

  it('parses a successful verification including amount and currency', async () => {
    const { impl, calls } = recordingFetch(fixture('paystack-verify.json'));
    const provider = new PaystackProvider('sk_test_fixture', impl);
    const result = await provider.verify('LGT_fixture_1');
    expect(result).toEqual({
      status: 'success',
      reference: 'LGT_fixture_1',
      amountKobo: 100_000,
      currency: 'NGN',
    });
    expect(calls[0]?.url).toContain('/transaction/verify/LGT_fixture_1');
  });

  it('throws a clear provider error when Paystack rejects the request', async () => {
    const { impl } = recordingFetch(fixture('paystack-error.json'), 401);
    const provider = new PaystackProvider('sk_test_fixture', impl);
    await expect(
      provider.initialize({
        reference: 'LGT_x',
        amountKobo: 1000,
        email: 'student@test.local',
        callbackUrl: 'https://uselogit.cv',
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe('Gemini contract (recording client)', () => {
  it('uses GEMINI_MODEL and asks for JSON output', async () => {
    const output = {
      weekNumber: 2,
      days: [{ date: '2026-02-02', entry: 'I worked on cable termination.', basedOn: ['T1'] }],
      weeklySummary: 'Cabling.',
    };
    const calls: Parameters<GeminiClientLike['models']['generateContent']>[0][] = [];
    const client: GeminiClientLike = {
      models: {
        async generateContent(args) {
          calls.push(args);
          return { text: JSON.stringify(output) };
        },
      },
    };
    const provider = new GeminiProvider('key', 'gemini-2.5-flash', client);
    const result = await provider.generateWeek(weekInput);
    expect(result.days[0]?.date).toBe('2026-02-02');
    expect(calls[0]?.model).toBe('gemini-2.5-flash');
    expect(calls[0]?.config?.responseMimeType).toBe('application/json');
    expect(calls[0]?.contents).toContain('Cable termination');
  });

  it('tolerates fenced JSON and rejects text that is not JSON', async () => {
    let reply = '```json\n{"weekNumber":2,"days":[]}\n```';
    const client: GeminiClientLike = {
      models: {
        async generateContent() {
          return { text: reply };
        },
      },
    };
    const provider = new GeminiProvider('key', 'gemini-test', client);
    const parsed = await provider.generateWeek(weekInput);
    expect(parsed.weekNumber).toBe(2);

    reply = 'I cannot help with that.';
    await expect(provider.generateWeek(weekInput)).rejects.toThrow(/not JSON/i);
  });

  it('shortens and strips surrounding quotes', async () => {
    const client: GeminiClientLike = {
      models: {
        async generateContent() {
          return { text: '  "I terminated cables."  ' };
        },
      },
    };
    const provider = new GeminiProvider('key', 'gemini-test', client);
    expect(await provider.shorten({ text: 'I terminated the network cables carefully.', maxChars: 30 })).toBe(
      'I terminated cables.',
    );
  });
});
