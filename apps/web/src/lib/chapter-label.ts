import {
  moveNumber,
  type Chapter,
  type ChapterDistinction,
} from '@mychess/chess';

/**
 * The translator part chapter titles need (next-intl's `t`): each
 * `chapter.*` key with the values its message takes.
 */
export interface ChapterTranslator {
  (key: 'chapter.untitled', values: { number: number }): string;
  (
    key: 'chapter.distinct',
    values: { name: string; eco: string; move: string },
  ): string;
  (key: 'chapter.distinctMove', values: { name: string; move: string }): string;
  (key: 'chapter.distinctEco', values: { name: string; eco: string }): string;
}

/** An opening's name by its ECO code. */
export type EcoNameOf = (eco: string) => string;

/**
 * What the server sends the browser to title a repertoire's chapters, so the
 * browser never loads the ECO tables (plan decision 17): the names of the
 * openings the chapters are named after, and what tells apart chapters that
 * share a title (R-158), both by plain records.
 */
export interface ChapterNames {
  /** Opening names by ECO code. */
  readonly ecoNames: Readonly<Record<string, string>>;
  /** `chapterDistinctions` by chapter id. */
  readonly distinctions: Readonly<Record<string, ChapterDistinction>>;
}

/** Keeps a move's number and its SAN on one line on a phone. */
const NO_BREAK_SPACE = '\u00A0';

/** "3. e5" or "2... d5": the move a chapter parts from the others at. */
function moveText({ firstMove }: ChapterDistinction): string | null {
  if (firstMove === null) return null;
  const { ply, san, whiteFirst } = firstMove;
  return `${moveNumber(ply, whiteFirst)}${NO_BREAK_SPACE}${san}`;
}

/**
 * `name` with its opening's ECO code and first move of its own, as far as
 * the distinction has them: "Karo-Kano gynyba (B12, 3. e5)".
 */
function distinctTitle(
  name: string,
  distinction: ChapterDistinction | undefined,
  t: ChapterTranslator,
): string {
  if (distinction === undefined) return name;
  const { eco } = distinction;
  const move = moveText(distinction);
  if (eco !== null && move !== null) {
    return t('chapter.distinct', { name, eco, move });
  }
  if (move !== null) return t('chapter.distinctMove', { name, move });
  if (eco !== null) return t('chapter.distinctEco', { name, eco });
  return name;
}

/**
 * Each chapter's title by id (R-158): its `baseTitle`, except that chapters
 * sharing one title each get their distinction from `distinctions`. The one
 * place a repertoire's chapter titles are decided, in the browser and on
 * the server alike.
 */
export function chapterTitles(
  chapters: readonly Chapter[],
  baseTitle: (chapter: Chapter) => string,
  distinctions: Readonly<Record<string, ChapterDistinction>>,
  t: ChapterTranslator,
): Readonly<Record<string, string>> {
  const bases = chapters.map(
    (chapter) => [chapter, baseTitle(chapter)] as const,
  );
  const uses = new Map<string, number>();
  for (const [, base] of bases) uses.set(base, (uses.get(base) ?? 0) + 1);
  return Object.fromEntries(
    bases.map(([chapter, base]) => [
      chapter.id,
      (uses.get(base) ?? 0) > 1
        ? distinctTitle(base, distinctions[chapter.id], t)
        : base,
    ]),
  );
}

/**
 * A chapter's own title, without any distinction: its own name, its
 * opening's name by `ecoNameOf`, or "Chapter N". The one definition, in the
 * browser (over the names the server sent) and on the server (over the ECO
 * tables), which the rename field starts from.
 */
export function baseTitle(
  t: ChapterTranslator,
  ecoNameOf: EcoNameOf,
): (chapter: Chapter) => string {
  return ({ nameSource }) => {
    switch (nameSource.kind) {
      case 'custom':
      case 'header':
        return nameSource.name;
      case 'eco':
        return ecoNameOf(nameSource.eco);
      case 'index':
        return t('chapter.untitled', { number: nameSource.number });
    }
  };
}

/**
 * A chapter's base title in the browser, from the names the server sent; an
 * ECO code with no name is called by its code, as `ecoName` does.
 */
export function plainChapterLabel(
  t: ChapterTranslator,
  names: ChapterNames,
): (chapter: Chapter) => string {
  return baseTitle(t, (eco) => names.ecoNames[eco] ?? eco);
}

/**
 * What to call a chapter of `chapters` in the browser: its `chapterTitles`
 * title from the names the server sent. A chapter not among them gets its
 * plain title.
 */
export function chapterLabel(
  t: ChapterTranslator,
  names: ChapterNames,
  chapters: readonly Chapter[],
): (chapter: Chapter) => string {
  const plain = plainChapterLabel(t, names);
  const titles = chapterTitles(chapters, plain, names.distinctions, t);
  return (chapter) => titles[chapter.id] ?? plain(chapter);
}
