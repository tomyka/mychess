import {
  START_KEY,
  type Chapter,
  type ChapterNameSource,
} from '@mychess/chess';
import { describe, expect, it, vi } from 'vitest';
import { chapterLabel } from './chapter-label';

const chapter = (nameSource: ChapterNameSource): Chapter => ({
  id: 'c1',
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

describe('chapterLabel', () => {
  const t = vi.fn(
    (_key: 'chapter.untitled', values: { number: number }) =>
      `Skyrius ${String(values.number)}`,
  );
  const label = chapterLabel(t, { D02: 'Londono sistema' });

  it('names an ECO chapter from the names it was given, or by its code', () => {
    expect(label(chapter({ kind: 'eco', eco: 'D02' }))).toBe('Londono sistema');
    expect(label(chapter({ kind: 'eco', eco: 'A00' }))).toBe('A00');
  });

  it('keeps a custom or header name as it is', () => {
    expect(label(chapter({ kind: 'custom', name: 'Mano' }))).toBe('Mano');
    expect(label(chapter({ kind: 'header', name: 'Event' }))).toBe('Event');
  });

  it('numbers an untitled chapter through the catalogue', () => {
    expect(label(chapter({ kind: 'index', number: 3 }))).toBe('Skyrius 3');
    expect(t).toHaveBeenLastCalledWith('chapter.untitled', { number: 3 });
  });
});
