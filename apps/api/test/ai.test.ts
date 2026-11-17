import { describe, expect, it } from 'vitest';
import { generateValidatedWeek } from '../src/services/ai/generate.js';
import { validateWeekOutput } from '../src/services/ai/validate.js';
import type { AiProvider, WeekInput, WeekOutput } from '../src/services/ai/types.js';

const input: WeekInput = {
  weekNumber: 1,
  programme: 'SIWES',
  department: 'Computer Science',
  company: 'Chidera Ventures',
  unit: 'IT Support',
  tasks: [
    { id: 'T1', text: 'Cable termination for Chidera Okonkwo at ada@example.com' },
    { id: 'T2', text: 'Printer configuration, call 08031234567' },
    { id: 'T3', text: 'Fault documentation for matric CSC/2021/1234' },
  ],
  tools: ['crimping tool'],
  skills: ['fault finding'],
  dates: [
    { date: '2026-02-02', dayName: 'Monday' },
    { date: '2026-02-03', dayName: 'Tuesday' },
    { date: '2026-02-04', dayName: 'Wednesday' },
  ],
  detail: 'standard',
  maxCharsPerEntry: 200,
  weeklyHighlights: 'Ada Okonkwo visited the unit on 08031234567.',
};

function makeValidOutput(source: WeekInput): WeekOutput {
  return {
    weekNumber: source.weekNumber,
    days: source.dates.map((date, index) => ({
      date: date.date,
      entry: `I worked on task ${index + 1} in the unit and checked the result before I stopped.`,
      basedOn: [source.tasks[index]?.id ?? 'T1'],
    })),
    weeklySummary: 'A steady week of cabling and documentation.',
  };
}

describe('AI redaction and validation', () => {
  it('never sends names, matric numbers, emails or phones to the provider', async () => {
    const received: WeekInput[] = [];
    const provider: AiProvider = {
      name: 'capture',
      async generateWeek(week) {
        received.push(week);
        return makeValidOutput(week);
      },
      async shorten({ text }) {
        return text;
      },
      async chat() {
        return 'ok';
      },
    };

    const result = await generateValidatedWeek({
      provider,
      input,
      studentName: 'Chidera Okonkwo',
      matricNo: 'CSC/2021/1234',
    });

    expect(result.output.days).toHaveLength(3);
    expect(result.removed.length).toBeGreaterThan(0);

    const payload = JSON.stringify(received);
    expect(payload).not.toContain('Chidera');
    expect(payload).not.toContain('Okonkwo');
    expect(payload).not.toContain('ada@example.com');
    expect(payload).not.toContain('08031234567');
    expect(payload).not.toContain('CSC/2021/1234');
    expect(payload).toContain('[NAME]');
  });

  it('rejects output with the wrong dates and retries', async () => {
    let calls = 0;
    const provider: AiProvider = {
      name: 'bad-dates',
      async generateWeek(week) {
        calls += 1;
        const output = makeValidOutput(week);
        output.days[0]!.date = '2026-03-01';
        return output;
      },
      async shorten({ text }) {
        return text;
      },
      async chat() {
        return '';
      },
    };
    await expect(generateValidatedWeek({ provider, input })).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
    expect(calls).toBe(3);
  });

  it('rejects unknown task ids and repeated days', () => {
    const output = makeValidOutput(input);
    output.days[0]!.basedOn = ['T99'];
    output.days[1]!.entry = output.days[0]!.entry;
    const result = validateWeekOutput(output, input);
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/unknown task/);
    expect(result.issues.join(' ')).toMatch(/repeats/);
  });

  it('rejects entries that leak identifiers or exceed the budget', () => {
    const output = makeValidOutput(input);
    output.days[0]!.entry = 'My matric is CSC/2021/1234 and my email is ada@example.com';
    output.days[1]!.entry = 'x'.repeat(500);
    const result = validateWeekOutput(output, input);
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/personal identifiers|longer/);
  });

  it('accepts the mock provider output end to end', async () => {
    const { MockAiProvider } = await import('../src/services/ai/mock.js');
    const provider = new MockAiProvider();
    const result = await generateValidatedWeek({ provider, input });
    expect(result.output.days.map((day) => day.date)).toEqual(input.dates.map((day) => day.date));
    for (const day of result.output.days) {
      expect(day.entry.length).toBeLessThanOrEqual(200);
      expect(day.basedOn.length).toBeGreaterThan(0);
    }
  });
});
