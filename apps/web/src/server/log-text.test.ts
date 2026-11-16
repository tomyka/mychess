import { describe, expect, it } from 'vitest';
import { logText } from './log-text';

describe('what a log line says of an error (security L1)', () => {
  it('names an error by its name alone, never its message', () => {
    expect(logText(new TypeError('a text that may name anything'))).toBe(
      'TypeError',
    );
  });

  it('says nothing of a thrown value that is no error', () => {
    expect(logText('90000001')).toBe('unknown error');
    expect(logText(undefined)).toBe('unknown error');
  });

  it('gives a failed query its cause, capped, never the query or its parameters', () => {
    const cause = new Error(`connection terminated ${'x'.repeat(300)}`);
    const failed = Object.assign(
      new Error('Failed query: insert ...\nparams: 90000001,Pavyzdyte, Ruta'),
      { query: 'insert ...', params: [90_000_001, 'Pavyzdyte, Ruta'], cause },
    );
    const text = logText(failed);
    expect(text).toBe(`Error: ${cause.message.slice(0, 200)}`);
    expect(text).not.toContain('90000001');
    expect(text).not.toContain('Failed query');
  });
});
