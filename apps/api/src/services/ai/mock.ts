import { WEEKDAY_NAMES } from '@logit/shared';
import type { ReportFacts, ReportOutput } from '@logit/shared';
import type { AiProvider, SafeContext, WeekInput, WeekOutput } from './types.js';

const OPENERS = [
  'I worked on {task}.',
  'Today I continued with {task}.',
  'I spent the day on {task}.',
  'My focus today was {task}.',
  'I carried out {task} again with more independence.',
  'I returned to {task} and took it further.',
];

const FOLLOW_UPS = [
  'I followed the steps I had been shown, checked my work as I went and noted what I completed.',
  'I took it in stages, reviewed the result and corrected anything that looked wrong before I stopped.',
  'I paid attention to doing it properly and confirmed the outcome matched what was expected.',
  'I worked through it carefully, compared the result with the instructions I was given and kept a record of what I did.',
  'I checked each step as I went and fixed the parts that did not come out right.',
  'I kept the workspace tidy, finished the part I started and recorded the progress I made.',
];

function trimTo(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:\s]+$/, '')}.`;
}

function buildEntry(input: WeekInput, index: number, taskIndex: number): string {
  const task = input.tasks[taskIndex % input.tasks.length]!;
  const opener = OPENERS[(index + input.weekNumber) % OPENERS.length]!;
  const follow = FOLLOW_UPS[(index * 2 + input.weekNumber) % FOLLOW_UPS.length]!;
  let text = `${opener.replace('{task}', task.text)} ${follow}`;
  if (input.detail === 'short') {
    const firstSentence = text.split('. ')[0] ?? text;
    text = `${firstSentence}.`;
  } else if (input.detail === 'detailed') {
    const secondTask = input.tasks[(taskIndex + 1) % input.tasks.length]!;
    if (secondTask.id !== task.id) {
      text += ` I also spent time on ${secondTask.text}, following the same approach.`;
    }
  }
  return trimTo(text, input.maxCharsPerEntry);
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async generateWeek(input: WeekInput): Promise<WeekOutput> {
    const days = input.dates.map((date, index) => {
      const taskIndex = (index + input.weekNumber - 1) % Math.max(1, input.tasks.length);
      const task = input.tasks[taskIndex]!;
      return {
        date: date.date,
        entry: buildEntry(input, index, taskIndex),
        basedOn: [task.id],
      };
    });
    const first = input.tasks[0];
    const second = input.tasks[1] ?? first;
    const summary =
      first && second
        ? `Week ${input.weekNumber}: ${first.text} and ${second.text}.`
        : `Week ${input.weekNumber} completed.`;
    return { weekNumber: input.weekNumber, days, weeklySummary: trimTo(summary, 180) };
  }

  async generateReport(input: ReportFacts): Promise<ReportOutput> {
    const duration = input.durationWeeks ? ` over ${input.durationWeeks} weeks` : '';
    return {
      title: input.title,
      sections: [
        {
          heading: 'Introduction',
          body: `This report documents the project "${input.title}"${input.course ? ` for ${input.course}` : ''}${duration}. The work described here reflects only the activities the student carried out and recorded.`,
        },
        {
          heading: 'Approach',
          body: `The work was planned around the stated objectives: ${input.objectives}`,
        },
        {
          heading: 'Activities Carried Out',
          body: input.activities,
        },
        {
          heading: 'Tools and Equipment',
          body: input.tools || 'The tools and equipment used are listed in the student\u2019s own notes.',
        },
        {
          heading: 'Outcomes',
          body: input.outcomes,
        },
        {
          heading: 'Conclusion',
          body: 'The activities above were completed as described. The student should review this report, correct anything inaccurate, and add their own name, matric number and signature before submission.',
        },
      ],
    };
  }

  async shorten(input: { text: string; maxChars: number }): Promise<string> {
    return trimTo(input.text, input.maxChars);
  }

  async chat(input: { context: SafeContext; message: string }): Promise<string> {
    const task = input.context.tasks[0];
    const day = WEEKDAY_NAMES[1];
    if (!task) {
      return 'Add at least three tasks you actually did, then I can help you describe them. I will not invent work you did not do.';
    }
    return `Describe the specific steps you took on "${task.text}". For example: what you started with, what you did yourself, what you checked, and how you knew it was correct. Keep it in past tense. I can only reword what you tell me — I will not invent ${day} activity.`;
  }
}
