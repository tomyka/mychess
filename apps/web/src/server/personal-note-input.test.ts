import { describe, expect, it } from 'vitest';
import { parsePersonalNote } from './personal-note-input';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOTE = { repertoireId: ID, moveKey: 'k|d4', text: 'Mano planas' };

describe('parsePersonalNote', () => {
  it('takes a repertoire id, a move key and the note’s text', () => {
    expect(parsePersonalNote(NOTE)).toEqual({ ok: true, value: NOTE });
  });

  it('takes an empty text, which deletes the note', () => {
    expect(parsePersonalNote({ ...NOTE, text: '' })).toEqual({
      ok: true,
      value: { ...NOTE, text: '' },
    });
  });

  it('says a note too long is too long', () => {
    expect(parsePersonalNote({ ...NOTE, text: 'x'.repeat(2001) })).toEqual({
      ok: false,
      refusal: { reason: 'personalNote.tooLong' },
    });
  });

  it('reads any other malformed request as not found', () => {
    for (const input of [
      { ...NOTE, repertoireId: 'not-a-uuid' },
      { ...NOTE, moveKey: '' },
      { ...NOTE, moveKey: 'k'.repeat(121) },
      { ...NOTE, text: 3 },
      null,
      'note',
    ])
      expect(parsePersonalNote(input)).toEqual({
        ok: false,
        refusal: { reason: 'repertoire.notFound' },
      });
  });
});
