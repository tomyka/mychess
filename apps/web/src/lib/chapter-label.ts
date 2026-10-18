import type { Chapter } from '@mychess/chess';

/** The translator part chapter names need (next-intl's `t`). */
export type ChapterTranslator = (
  key: 'chapter.untitled',
  values: { number: number },
) => string;

/**
 * What to call a chapter: its own name, its opening's name from `ecoNames`
 * (the server passes the ones a repertoire uses, so the browser never loads
 * the ECO tables, plan decision 17), or "Chapter N".
 */
export function chapterLabel(
  t: ChapterTranslator,
  ecoNames: Readonly<Record<string, string>>,
): (chapter: Chapter) => string {
  return ({ nameSource }) => {
    switch (nameSource.kind) {
      case 'custom':
      case 'header':
        return nameSource.name;
      case 'eco':
        return ecoNames[nameSource.eco] ?? nameSource.eco;
      case 'index':
        return t('chapter.untitled', { number: nameSource.number });
    }
  };
}
