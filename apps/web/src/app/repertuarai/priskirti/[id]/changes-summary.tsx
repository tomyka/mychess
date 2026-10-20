'use client';

import {
  chapterPlies,
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
import { moveNumber } from '../../../repertoire-view';

/** The moves one chapter gained and lost; `chapter` undefined: deleted since. */
interface ChapterChanges {
  readonly chapter: Chapter | undefined;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * A changed move as the move list writes it, `2. Bf4` or `1... c5`; just
 * its SAN when the chapter does not have it (a removed move).
 */
function moveLabels(
  graph: RepertoireGraph,
  chapter: Chapter | undefined,
): (key: string) => string {
  const plies: ReadonlyMap<string, number> =
    chapter === undefined ? new Map() : chapterPlies(graph, chapter.id);
  const whiteFirst =
    chapter !== undefined && sideToMove(chapter.rootKey) === 'w';
  return (key) => {
    const { san } = splitMoveKey(key);
    const ply = plies.get(key);
    return ply === undefined ? san : `${moveNumber(ply, whiteFirst)} ${san}`;
  };
}

/** The changes by chapter, in the repertoire's order; deleted chapters last. */
function byChapter(
  graph: RepertoireGraph,
  changes: MoveChanges,
): ChapterChanges[] {
  const known = new Set(graph.chapters.map((chapter) => chapter.id));
  const groups: (Chapter | undefined)[] = [...graph.chapters, undefined];
  return groups.flatMap((chapter) => {
    const inGroup = (link: MoveLink): boolean =>
      chapter === undefined
        ? !known.has(link.chapterId)
        : link.chapterId === chapter.id;
    const label = moveLabels(graph, chapter);
    const added = changes.added.filter(inGroup).map((l) => label(l.moveKey));
    const removed = changes.removed
      .filter(inGroup)
      .map((l) => label(l.moveKey));
    return added.length + removed.length === 0
      ? []
      : [{ chapter, added, removed }];
  });
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
  const { chapter, added, removed } = changes;
  return (
    <li className="flex flex-col gap-1">
      <h3 className="font-semibold">
        {chapter === undefined
          ? t('assignment.changes.deletedChapters')
          : chapterLabel(t, ecoNames)(chapter)}
      </h3>
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
  if (chapters.length === 0 && changes.annotated === 0) return null;
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
      {changes.annotated === 0 ? null : (
        <p>{t('commentsChanged', { count: changes.annotated })}</p>
      )}
    </section>
  );
}
