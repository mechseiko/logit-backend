import { describe, expect, it } from 'vitest';
import { containsPii, redact } from '../src/index.js';

describe('redact', () => {
  it('removes name tokens', () => {
    const result = redact('I, Chidera Okonkwo, worked on cable termination with Chidera.', {
      fullName: 'Chidera Okonkwo',
    });
    expect(result.clean).not.toMatch(/Chidera/i);
    expect(result.clean).not.toMatch(/Okonkwo/i);
    expect(result.clean).toContain('[NAME]');
    expect(result.removed).toContain('your name');
  });

  it('removes the exact matric number and matric-like patterns', () => {
    const result = redact('My matric is 2021/ET/1234 and my ID is 190404021.', {
      matricNo: '2021/ET/1234',
    });
    expect(result.clean).not.toContain('2021/ET/1234');
    expect(result.clean).not.toContain('190404021');
    expect(result.clean).toContain('[MATRIC]');
  });

  it('removes emails and Nigerian phone numbers', () => {
    const result = redact('Reach me on ada@example.com or 08031234567, also +2348031234567.');
    expect(result.clean).not.toContain('ada@example.com');
    expect(result.clean).not.toContain('08031234567');
    expect(result.removed).toContain('an email address');
    expect(result.removed).toContain('a phone number');
  });

  it('leaves ordinary task text alone', () => {
    const text = 'I terminated network cables and tested them with a cable tester.';
    const result = redact(text, { fullName: 'Tunde Bakare', matricNo: 'CSC/2020/1001' });
    expect(result.clean).toBe(text);
    expect(result.removed).toEqual([]);
    expect(containsPii(text)).toBe(false);
  });

  it('does not treat normal words as names', () => {
    const result = redact('I worked in the server room on Monday.', { fullName: 'Room Server' });
    expect(result.clean).toContain('server room');
  });
});
