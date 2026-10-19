import { describe, expect, it } from 'vitest';
import { parseShares } from './share-input';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

function form(
  repertoireId: string | Blob | null,
  coachIds: readonly (string | Blob)[],
): FormData {
  const data = new FormData();
  if (repertoireId !== null) data.set('repertoireId', repertoireId);
  for (const id of coachIds) data.append('coachIds', id);
  return data;
}

describe('parseShares', () => {
  it('takes the repertoire and every ticked coach', () => {
    expect(parseShares(form(REPERTOIRE, ['c-1', 'c-2']))).toEqual({
      ok: true,
      value: { repertoireId: REPERTOIRE, coachIds: ['c-1', 'c-2'] },
    });
  });

  it('takes no coach as sharing with nobody', () => {
    expect(parseShares(form(REPERTOIRE, []))).toEqual({
      ok: true,
      value: { repertoireId: REPERTOIRE, coachIds: [] },
    });
  });

  it('keeps 100 coaches', () => {
    const many = Array.from({ length: 100 }, (_, i) => `c-${String(i)}`);
    expect(parseShares(form(REPERTOIRE, many))).toHaveProperty('ok', true);
  });

  it.each([
    ['a malformed repertoire', form('nėra', ['c-1']), 'share.notOwner'],
    ['no repertoire', form(null, ['c-1']), 'share.notOwner'],
    ['a file for the repertoire', form(new Blob(['x']), []), 'share.notOwner'],
    ['an empty coach id', form(REPERTOIRE, ['']), 'share.notLinked'],
    [
      'a coach id too long',
      form(REPERTOIRE, ['c'.repeat(101)]),
      'share.notLinked',
    ],
    [
      'a file for a coach',
      form(REPERTOIRE, [new Blob(['x'])]),
      'share.notLinked',
    ],
    [
      'more than 100 coaches',
      form(
        REPERTOIRE,
        Array.from({ length: 101 }, (_, i) => `c-${String(i)}`),
      ),
      'share.notLinked',
    ],
  ])('refuses %s', (_, data, reason) => {
    expect(parseShares(data)).toEqual({ ok: false, refusal: { reason } });
  });
});
