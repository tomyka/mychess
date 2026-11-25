import {
  chapterDistinctions,
  ecoName,
  taxonomyNames,
  type Chapter,
  type ChapterTitles,
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

/** `baseTitle` over `graph`'s taxonomy names (R-216), in `locale`. */
function baseTitleIn(
  t: ChapterTranslator,
  graph: RepertoireGraph,
  locale: Locale,
): (chapter: Chapter) => string {
  const names = taxonomyNames(graph, locale);
  return baseTitle(t, (id, eco) => names.get(id) ?? ecoName(eco, locale));
}

/**
 * What to call a repertoire's chapters in `locale` with no distinction: its
 * name, its opening, or "Chapter N". For the PGN download and the data
 * export, which name chapters from the repertoire they belong to.
 */
export function plainChapterTitleIn(wanted: Locale): ChapterTitles {
  const locale = resolveLocale(wanted);
  const t = translatorIn(locale);
  return (graph) => baseTitleIn(t, graph, locale);
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
  const plain = baseTitleIn(t, graph, locale);
  const titles = chapterTitles(
    graph.chapters,
    plain,
    Object.fromEntries(chapterDistinctions(graph)),
    t,
  );
  return (chapter) => titles[chapter.id] ?? plain(chapter);
}

/**
 * What the browser needs to title this graph's chapters (`chapterLabel`):
 * its chapters' opening names (decision 17, R-216) and distinctions
 * (R-158), serialisable.
 */
export function chapterNamesOf(
  graph: RepertoireGraph,
  wanted: Locale,
): ChapterNames {
  return {
    taxonomyNames: Object.fromEntries(
      taxonomyNames(graph, resolveLocale(wanted)),
    ),
    distinctions: Object.fromEntries(chapterDistinctions(graph)),
  };
}
