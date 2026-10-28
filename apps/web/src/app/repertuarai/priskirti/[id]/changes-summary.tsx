'use client';

import {
  chapterPlies,
  moveNumber,
  sideToMove,
  splitMoveKey,
  type Chapter,
  type MoveChanges,
  type MoveLink,
  type RepertoireGraph,
} from '@mychess/chess';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import { chapterLabel } from '../../../../lib/chapter-label';

/** The moves one chapter gained and lost; `chapter` undefined: deleted since. */
interface ChapterChanges {
  readonly chapter: Chapter | undefined;
  /** Its place in the repertoire, from 1, as the chapter list counts. */
  readonly number: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** Where a move the chapter does not have sorts: after every move it has. */
const UNKNOWN_PLY = Number.MAX_SAFE_INTEGER;

/**
 * One chapter's changed moves in the order they are played (by ply), those
 * it does not have (a removed move) last in the order they came; each as
 * the move list writes it, `2. Bf4` or `1... c5`, or just its SAN when the
 * chapter does not have it.
 */
function chapterMoves(
  graph: RepertoireGraph,
  chapter: Chapter | undefined,
): (links: readonly MoveLink[]) => string[] {
  const plies: ReadonlyMap<string, number> =
    chapter === undefined ? new Map() : chapterPlies(graph, chapter.id);
  const whiteFirst =
    chapter !== undefined && sideToMove(chapter.rootKey) === 'w';
  const plyOf = (link: MoveLink): number =>
    plies.get(link.moveKey) ?? UNKNOWN_PLY;
  const label = ({ moveKey }: MoveLink): string => {
    const { san } = splitMoveKey(moveKey);
    const ply = plies.get(moveKey);
    return ply === undefined ? san : `${moveNumber(ply, whiteFirst)} ${san}`;
  };
  return (links) => links.toSorted((a, b) => plyOf(a) - plyOf(b)).map(label);
}

/** The changes by chapter, in the repertoire's order; deleted chapters last. */
function byChapter(
  graph: RepertoireGraph,
  changes: MoveChanges,
): ChapterChanges[] {
  const known = new Set(graph.chapters.map((chapter) => chapter.id));
  const groups: (Chapter | undefined)[] = [...graph.chapters, undefined];
  return groups.flatMap((chapter, index) => {
    const inGroup = (link: MoveLink): boolean =>
      chapter === undefined
        ? !known.has(link.chapterId)
        : link.chapterId === chapter.id;
    const moves = chapterMoves(graph, chapter);
    const added = moves(changes.added.filter(inGroup));
    const removed = moves(changes.removed.filter(inGroup));
    return added.length + removed.length === 0
      ? []
      : [{ chapter, number: index + 1, added, removed }];
  });
}

/**
 * A chapter's heading: "Chapter N — its name", so two chapters named after
 * the same opening are told apart; just "Chapter N" when that is its name.
 */
function useHeading(
  ecoNames: Readonly<Record<string, string>>,
): (changes: ChapterChanges) => string {
  const t = useTranslations();
  return ({ chapter, number }) => {
    if (chapter === undefined) return t('assignment.changes.deletedChapters');
    const name = chapterLabel(t, ecoNames)(chapter);
    return chapter.nameSource.kind === 'index'
      ? name
      : t('assignment.changes.chapter', { number, name });
  };
}

/** One chapter's heading and its added and removed moves. */
function ChapterLines({
  changes,
  ecoNames,
}: {
  readonly changes: ChapterChanges;
  readonly ecoNames: Readonly<Record<string, string>>;
}): JSX.Element {
  const t = useTranslations();
  const format = useFormatter();
  const list = (moves: readonly string[]): string =>
    format.list(moves, { type: 'conjunction' });
  const heading = useHeading(ecoNames);
  const { added, removed } = changes;
  return (
    <li className="flex flex-col gap-1">
      <h3 className="font-semibold">{heading(changes)}</h3>
      {added.length === 0 ? null : (
        <p>{t('assignment.changes.added', { moves: list(added) })}</p>
      )}
      {removed.length === 0 ? null : (
        <p>{t('assignment.changes.removed', { moves: list(removed) })}</p>
      )}
    </li>
  );
}

export interface ChangesSummaryProps {
  /** The repertoire as the page shows it: the chapters the changes name. */
  readonly graph: RepertoireGraph;
  /** What changed since the player last opened it (changesSince). */
  readonly changes: MoveChanges;
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
}

/**
 * What the coach changed since the player last opened the repertoire
 * (R-133): the moves added and removed by chapter, and how many comments
 * changed. Nothing when nothing did.
 */
export function ChangesSummary({
  graph,
  changes,
  ecoNames,
}: ChangesSummaryProps): JSX.Element | null {
  const t = useTranslations('assignment.changes');
  const titleId = useId();
  const chapters = byChapter(graph, changes);
  if (chapters.length === 0 && changes.commentsChanged === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-card border border-accent p-3"
    >
      <h2 id={titleId} className="font-bold">
        {t('title')}
      </h2>
      {chapters.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {chapters.map((group) => (
            <ChapterLines
              key={group.chapter?.id ?? ''}
              changes={group}
              ecoNames={ecoNames}
            />
          ))}
        </ul>
      )}
      {changes.commentsChanged === 0 ? null : (
        <p>{t('commentsChanged', { count: changes.commentsChanged })}</p>
      )}
    </section>
  );
}
