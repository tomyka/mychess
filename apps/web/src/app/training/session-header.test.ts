import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { LOCALE, MESSAGES } from '../../i18n/catalogue';
import { sessionHeader, type HeaderWords } from './session-header';

// The catalogue's words, as the screen reads them.
const t = createTranslator({
  locale: LOCALE,
  messages: MESSAGES,
  namespace: 'training',
});
const words: HeaderWords = {
  word: (key) => t(key),
  repertoire: (values) => t('context.repertoire', values),
  chapter: (values) => t('context.chapter', values),
  side: (values) => t('context.side', values),
};
const CARO = {
  name: 'Caro-Kann',
  side: 'black' as const,
  chapter: 'Main line',
};

describe('sessionHeader (R-224)', () => {
  it('titles a session over every repertoire by its name, the item under it in parts', () => {
    expect(
      sessionHeader({ mode: 'review', scopedName: null, item: CARO }, words),
    ).toEqual({
      title: "Today's review",
      context: {
        text: 'Caro-Kann (Black) · Main line',
        name: 'Caro-Kann',
        side: '(Black)',
        chapter: 'Main line',
      },
    });
    expect(
      sessionHeader({ mode: 'learn', scopedName: null, item: CARO }, words)
        .title,
    ).toBe('Learn new moves');
  });

  it('titles a scoped session by its repertoire, the side and chapter under it', () => {
    expect(
      sessionHeader(
        { mode: 'review', scopedName: 'Caro-Kann', item: CARO },
        words,
      ),
    ).toEqual({
      title: 'Caro-Kann',
      context: {
        text: 'Black · Main line',
        name: null,
        side: 'Black',
        chapter: 'Main line',
      },
    });
  });

  it('has no context line without an item, and leaves out a missing chapter', () => {
    expect(
      sessionHeader(
        { mode: 'review', scopedName: null, item: undefined },
        words,
      ),
    ).toEqual({ title: "Today's review", context: null });
    expect(
      sessionHeader(
        {
          mode: 'review',
          scopedName: null,
          item: { ...CARO, chapter: null },
        },
        words,
      ).context,
    ).toEqual({
      text: 'Caro-Kann (Black)',
      name: 'Caro-Kann',
      side: '(Black)',
      chapter: null,
    });
  });

  it('names the side in its own words for a white item', () => {
    expect(
      sessionHeader(
        {
          mode: 'learn',
          scopedName: 'London',
          item: { name: 'London', side: 'white', chapter: null },
        },
        words,
      ),
    ).toEqual({
      title: 'London',
      context: { text: 'White', name: null, side: 'White', chapter: null },
    });
  });
});
