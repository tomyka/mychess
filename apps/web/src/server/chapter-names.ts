import {
  chapterDistinctions,
  ecoName,
  taxonomyNames,
  type Chapter,
  type ChapterTitles,
  type RepertoireGraph,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { LOCALE, MESSAGES } from '../i18n/catalogue';
import {
  baseTitle,
  chapterTitles,
  type ChapterNames,
  type ChapterTranslator,
} from '../lib/chapter-label';

/**
 * The catalogue as a chapter translator: from `createTranslator`, as in
 * mail.ts, so no request is needed.
 */
const translator: ChapterTranslator = createTranslator({
  locale: LOCALE,
  messages: MESSAGES,
});

/** `baseTitle` over `graph`'s taxonomy names (R-216). */
function baseTitleOf(graph: RepertoireGraph): (chapter: Chapter) => string {
  const names = taxonomyNames(graph);
  return baseTitle(translator, (id, eco) => names.get(id) ?? ecoName(eco));
}

/**
 * What to call a repertoire's chapters with no distinction: its name, its
 * opening, or "Chapter N". For the PGN download and the data export, which
 * name chapters from the repertoire they belong to.
 */
export const plainChapterTitle: ChapterTitles = baseTitleOf;

/**
 * What to call each of `graph`'s chapters, chapters that share a name told
 * apart (R-158): `chapterLabel` on the server. A chapter not in `graph`
 * gets its plain title.
 */
export function chapterLabelOf(
  graph: RepertoireGraph,
): (chapter: Chapter) => string {
  const plain = baseTitleOf(graph);
  const titles = chapterTitles(
    graph.chapters,
    plain,
    Object.fromEntries(chapterDistinctions(graph)),
    translator,
  );
  return (chapter) => titles[chapter.id] ?? plain(chapter);
}

/**
 * What the browser needs to title this graph's chapters (`chapterLabel`):
 * its chapters' opening names (decision 17, R-216) and distinctions
 * (R-158), serialisable.
 */
export function chapterNamesOf(graph: RepertoireGraph): ChapterNames {
  return {
    taxonomyNames: Object.fromEntries(taxonomyNames(graph)),
    distinctions: Object.fromEntries(chapterDistinctions(graph)),
  };
}

/** Every chapter of `graph` titled as on its page (R-158, R-216), by id: for the training header (R-224). */
export function chapterTitlesOf(
  graph: RepertoireGraph,
): Readonly<Record<string, string>> {
  const label = chapterLabelOf(graph);
  return Object.fromEntries(graph.chapters.map((c) => [c.id, label(c)]));
}
