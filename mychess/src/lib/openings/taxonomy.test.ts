import { describe, it, expect } from 'vitest';
import { CURATED_OPENINGS } from './taxonomy';
import { ECO_OPENINGS } from './eco-data';

describe('curated opening taxonomy', () => {
  it('gives every entry a unique id', () => {
    const ids = CURATED_OPENINGS.map((o) => o.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  // Two entries claiming the same code for the same side would make
  // resolveOpening's answer depend on array order, which is silent and
  // arbitrary. This is the authoring mistake most likely to happen as the
  // list grows.
  it('never lets two entries of the same side claim one ECO code', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const opening of CURATED_OPENINGS) {
      for (const code of opening.ecoCodes) {
        const key = `${code}/${opening.side}`;
        const owner = seen.get(key);
        if (owner) clashes.push(`${key} claimed by both ${owner} and ${opening.id}`);
        else seen.set(key, opening.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('gives every entry a Lithuanian name', () => {
    expect(CURATED_OPENINGS.filter((o) => !o.nameLt.trim()).map((o) => o.id)).toEqual([]);
  });

  it('gives every entry at least one ECO code', () => {
    expect(CURATED_OPENINGS.filter((o) => o.ecoCodes.length === 0).map((o) => o.id)).toEqual([]);
  });

  it('uses only white or black as the side', () => {
    expect(
      CURATED_OPENINGS.filter((o) => o.side !== 'white' && o.side !== 'black').map((o) => o.id)
    ).toEqual([]);
  });

  // A typo'd or malformed code (lowercase, wrong length, or one ECO never
  // assigned) fails silently: resolveOpening matches on exact string
  // equality, so the entry just never resolves for anyone. No error, no
  // signal — the feature quietly doesn't work. Cross-checking against the
  // real ECO table catches well-formed-but-nonexistent codes that a regex
  // would miss.
  it('claims only codes that exist in the ECO table', () => {
    const knownCodes = new Set(ECO_OPENINGS.map((o) => o.code));
    const unknown: string[] = [];
    for (const opening of CURATED_OPENINGS) {
      for (const code of opening.ecoCodes) {
        if (!knownCodes.has(code)) unknown.push(`${opening.id} claims unknown code ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
