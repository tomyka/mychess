import {
  chapterName,
  ecoName,
  type Chapter,
  type RepertoireGraph,
} from '@mychess/chess';
import type { Locale } from '@mychess/domain';
import { createTranslator } from 'next-intl';
import { MESSAGES } from '../i18n/locales';
import type { ChapterTranslator } from '../lib/chapter-label';

/**
 * What to call a chapter in `locale` on the server (the PGN download and
 * the data export): its name, its opening, or "Chapter N". A translator for
 * them comes from `createTranslator`, as in mail.ts, so no request is needed.
 */
export function chapterTitle(
  t: ChapterTranslator,
  locale: Locale,
): (chapter: Chapter) => string {
  return (chapter) => {
    const name = chapterName(chapter.nameSource, locale);
    return name.kind === 'text'
      ? name.text
      : t(name.key, { number: name.number });
  };
}

/** `chapterTitle` with `locale`'s own catalogue, for routes without a request locale. */
export function chapterTitleIn(locale: Locale): (chapter: Chapter) => string {
  const t = createTranslator({ locale, messages: MESSAGES[locale] });
  return chapterTitle((key, values) => t(key, values), locale);
}

/** The opening names the browser needs for this graph's ECO chapters (decision 17). */
export function ecoNamesOf(
  graph: RepertoireGraph,
  locale: Locale,
): Record<string, string> {
  const codes = graph.chapters.flatMap((c) =>
    c.nameSource.kind === 'eco' ? [c.nameSource.eco] : [],
  );
  return Object.fromEntries(codes.map((code) => [code, ecoName(code, locale)]));
}
