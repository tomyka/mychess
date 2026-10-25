'use client';

import {
  chapterOf,
  isPlayerMove,
  moveKey,
  sideToMove,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { moveNumber } from './board-play';
import { currentLineIndex } from './current-line';
import { KnowThisMenu } from './know-this-menu';
import { PANEL_LABEL } from './panel-styles';
import type { PanelTraining } from './train-buttons';

export interface KnowSectionProps {
  readonly training: PanelTraining;
  readonly graph: RepertoireGraph;
  readonly chapterId: string;
  /** The moves from the chapter root to the current one. */
  readonly path: readonly RepertoireMove[];
}

/** "6. Be2": the current move with its number, as the move list writes it. */
function moveLabel(
  graph: RepertoireGraph,
  chapterId: string,
  path: readonly RepertoireMove[],
  move: RepertoireMove,
): string {
  const root = chapterOf(graph, chapterId)?.rootKey ?? move.from;
  return `${moveNumber(path.length - 1, sideToMove(root) === 'w')} ${move.san}`;
}

/**
 * "I know this" and "Learn again" for the current move, when it is one of
 * the player's own, and for the line it is on (R-58, R-147). Nothing at
 * the chapter root: the chapter's own menu is on its row.
 */
export function KnowSection({
  training,
  graph,
  chapterId,
  path,
}: KnowSectionProps): JSX.Element | null {
  const t = useTranslations('training.know');
  const move = path.at(-1);
  const line = currentLineIndex(graph, chapterId, path);
  if (move === undefined || line === null) return null;
  const { repertoireId } = training;
  const key = moveKey(move.from, move.san);
  const subject = t('move', {
    move: moveLabel(graph, chapterId, path, move),
  });
  return (
    <section aria-label={t('section')} className="flex flex-col gap-1">
      <h2 className={PANEL_LABEL}>{t('section')}</h2>
      {isPlayerMove(graph, move) ? (
        <KnowThisMenu
          key={key}
          fields={{ kind: 'move', repertoireId, moveKey: key }}
          subject={subject}
        >
          <span className="flex-1">{subject}</span>
        </KnowThisMenu>
      ) : null}
      <KnowThisMenu
        key={`${chapterId}:${String(line)}`}
        fields={{
          kind: 'line',
          repertoireId,
          chapterId,
          lineIndex: String(line),
        }}
        subject={t('line')}
      >
        <span className="flex-1">{t('line')}</span>
      </KnowThisMenu>
    </section>
  );
}
