import { describe, expect, it } from 'vitest';
import { parseNewRepertoire } from './repertoire-input';

function form(fields: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refusal = (reason: string) => ({ ok: false, refusal: { reason } });

describe('parseNewRepertoire', () => {
  it('takes a trimmed name and a side', () => {
    expect(
      parseNewRepertoire(form({ name: '  Londono sistema ', side: 'white' })),
    ).toEqual({ ok: true, value: { name: 'Londono sistema', side: 'white' } });
    expect(
      parseNewRepertoire(form({ name: 'Taimanovas', side: 'black' })),
    ).toEqual({
      ok: true,
      value: { name: 'Taimanovas', side: 'black' },
    });
  });

  it('refuses a blank or missing name', () => {
    expect(parseNewRepertoire(form({ name: '   ', side: 'white' }))).toEqual(
      refusal('repertoire.nameBlank'),
    );
    expect(parseNewRepertoire(form({ side: 'white' }))).toEqual(
      refusal('repertoire.nameBlank'),
    );
  });

  it('refuses a name of 81 characters and takes one of 80', () => {
    expect(
      parseNewRepertoire(form({ name: 'a'.repeat(81), side: 'white' })),
    ).toEqual(refusal('repertoire.nameTooLong'));
    expect(
      parseNewRepertoire(form({ name: 'a'.repeat(80), side: 'white' })).ok,
    ).toBe(true);
  });

  it('refuses a side that is not White or Black', () => {
    expect(parseNewRepertoire(form({ name: 'Londonas', side: 'red' }))).toEqual(
      refusal('repertoire.sideInvalid'),
    );
    expect(parseNewRepertoire(form({ name: 'Londonas' }))).toEqual(
      refusal('repertoire.sideInvalid'),
    );
  });
});
