import { describe, expect, it } from 'vitest';
import { parseProfileInput } from './profile-input';

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refusalOf = (data: FormData): string | undefined => {
  const parsed = parseProfileInput(data);
  return parsed.ok ? undefined : parsed.refusal.reason;
};

describe('parseProfileInput', () => {
  it('reads a trimmed display name', () => {
    expect(parseProfileInput(form({ displayName: '  Rūta ' }))).toEqual({
      ok: true,
      value: { displayName: 'Rūta' },
    });
  });

  it('reads only the name, ignoring a language an old form still posts', () => {
    expect(
      parseProfileInput(form({ displayName: 'Rūta', locale: 'lt' })),
    ).toEqual({ ok: true, value: { displayName: 'Rūta' } });
  });

  it('keeps a name of exactly 50 characters', () => {
    const name = 'ą'.repeat(50);
    expect(parseProfileInput(form({ displayName: name }))).toEqual({
      ok: true,
      value: { displayName: name },
    });
  });

  it('refuses a blank name', () => {
    expect(refusalOf(form({ displayName: '   ' }))).toBe('displayName.blank');
  });

  it('refuses a 51-character name', () => {
    expect(refusalOf(form({ displayName: 'a'.repeat(51) }))).toBe(
      'displayName.tooLong',
    );
  });

  it('reads a missing name as blank', () => {
    expect(refusalOf(form({}))).toBe('displayName.blank');
  });

  it('reads a file sent as the name as blank', () => {
    expect(refusalOf(form({ displayName: new Blob(['Rūta']) }))).toBe(
      'displayName.blank',
    );
  });
});
