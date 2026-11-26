import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { LOCALE, MESSAGES } from '../../i18n/catalogue';
import type { TrainingData } from '../../lib/training-data';
import { sessionHeader, type HeaderScope } from './session-header';

// The catalogue's words, as the screen reads them.
const t = createTranslator({
  locale: LOCALE,
  messages: MESSAGES,
  namespace: 'training',
});

const CARO_ID = 'caro';
const LONDON_ID = 'london';

const entries: TrainingData['entries'] = [
  {
    id: CARO_ID,
    name: 'Caro-Kann',
    side: 'black',
    kind: 'own',
    active: true,
    chapterTitles: { main: 'Main line' },
    graph: graphOf(LONDON),
  },
  {
    id: LONDON_ID,
    name: 'London',
    side: 'white',
    kind: 'assigned',
    coachName: 'Coach',
    active: true,
    chapterTitles: {},
    graph: graphOf(LONDON),
  },
];

const scope = (
  mode: TrainingData['mode'],
  scopedId: string | null = null,
): HeaderScope => ({ data: { mode, entries }, scopedId });

const CARO_MAIN = { repertoireId: CARO_ID, chapterId: 'main' };

describe('sessionHeader (R-224)', () => {
  it('titles a session over every repertoire by its name, the item under it in parts', () => {
    expect(sessionHeader(scope('review'), CARO_MAIN, t)).toEqual({
      title: "Today's review",
      context: {
        text: 'Caro-Kann (Black) · Main line',
        name: 'Caro-Kann',
        side: '(Black)',
        chapter: 'Main line',
      },
    });
    expect(sessionHeader(scope('learn'), CARO_MAIN, t).title).toBe(
      'Learn new moves',
    );
  });

  it('titles a scoped session by its repertoire, the side and chapter under it', () => {
    expect(sessionHeader(scope('review', CARO_ID), CARO_MAIN, t)).toEqual({
      title: 'Caro-Kann',
      context: {
        text: 'Black · Main line',
        name: null,
        side: 'Black',
        chapter: 'Main line',
      },
    });
  });

  it('titles a session scoped to no repertoire it trains by its mode', () => {
    expect(sessionHeader(scope('review', 'gone'), undefined, t).title).toBe(
      "Today's review",
    );
  });

  it('has no context line without an item, or for an item of no known repertoire', () => {
    expect(sessionHeader(scope('review'), undefined, t)).toEqual({
      title: "Today's review",
      context: null,
    });
    const unknown = { repertoireId: 'gone', chapterId: 'main' };
    expect(sessionHeader(scope('review'), unknown, t).context).toBeNull();
    const none = { repertoireId: undefined, chapterId: 'main' };
    expect(sessionHeader(scope('review'), none, t).context).toBeNull();
  });

  it('leaves out a chapter the line has none of, or the entry has no title for', () => {
    const plain = {
      text: 'Caro-Kann (Black)',
      name: 'Caro-Kann',
      side: '(Black)',
      chapter: null,
    };
    const noChapter = { repertoireId: CARO_ID, chapterId: undefined };
    expect(sessionHeader(scope('review'), noChapter, t).context).toEqual(plain);
    const untitled = { repertoireId: CARO_ID, chapterId: 'c9' };
    expect(sessionHeader(scope('review'), untitled, t).context).toEqual(plain);
  });

  it('names the side in its own words for a white item', () => {
    const london = { repertoireId: LONDON_ID, chapterId: undefined };
    expect(sessionHeader(scope('learn', LONDON_ID), london, t)).toEqual({
      title: 'London',
      context: { text: 'White', name: null, side: 'White', chapter: null },
    });
  });
});
