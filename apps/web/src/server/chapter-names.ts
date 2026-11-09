import {
  chapterDistinctions,
  ecoName,
  type Chapter,
  type RepertoireGraph,
} from '@mychess/chess';
import type { Locale } from '@mychess/domain';
import { createTranslator } from 'next-intl';
import { MESSAGES, resolveLocale } from '../i18n/locales';
import {
  baseTitle,
  chapterTitles,
  type ChapterNames,
  type ChapterTranslator,
} from '../lib/chapter-label';

// Each exported function takes the locale asked for (an account's stored
// one) and names in the language served for it (R-180: English for now).

/**
 * `locale`'s own catalogue as a chapter translator: from `createTranslator`,
 * as in mail.ts, so no request is needed.
 */
function translatorIn(locale: Locale): ChapterTranslator {
  return createTranslator({ locale, messages: MESSAGES[locale] });
}

/** `baseTitle` over the ECO tables, in `locale`. */
function baseTitleIn(
  t: ChapterTranslator,
  locale: Locale,
): (chapter: Chapter) => string {
  return baseTitle(t, (eco) => ecoName(eco, locale));
}

/**
 * What to call a chapter in `locale` with no distinction: its name, its
 * opening, or "Chapter N". For the PGN download and the data export.
 */
export function plainChapterTitleIn(
  wanted: Locale,
): (chapter: Chapter) => string {
  const locale = resolveLocale(wanted);
  return baseTitleIn(translatorIn(locale), locale);
}

/**
 * What to call each of `graph`'s chapters in `locale`, chapters that share
 * a name told apart (R-158): `chapterLabel` on the server. A chapter not in
 * `graph` gets its plain title.
 */
export function chapterLabelIn(
  graph: RepertoireGraph,
  wanted: Locale,
): (chapter: Chapter) => string {
  const locale = resolveLocale(wanted);
  const t = translatorIn(locale);
  const plain = baseTitleIn(t, locale);
  const titles = chapterTitles(
    graph.chapters,
    plain,
    Object.fromEntries(chapterDistinctions(graph)),
    t,
  );
  return (chapter) => titles[chapter.id] ?? plain(chapter);
}

/** The opening names the browser needs for this graph's ECO chapters (decision 17). */
function ecoNamesOf(
  graph: RepertoireGraph,
  locale: Locale,
): Record<string, string> {
  const codes = graph.chapters.flatMap((c) =>
    c.nameSource.kind === 'eco' ? [c.nameSource.eco] : [],
  );
  return Object.fromEntries(codes.map((code) => [code, ecoName(code, locale)]));
}

/**
 * What the browser needs to title this graph's chapters (`chapterLabel`):
 * its opening names and its chapters' distinctions (R-158), serialisable.
 */
export function chapterNamesOf(
  graph: RepertoireGraph,
  wanted: Locale,
): ChapterNames {
  return {
    ecoNames: ecoNamesOf(graph, resolveLocale(wanted)),
    distinctions: Object.fromEntries(chapterDistinctions(graph)),
  };
}
