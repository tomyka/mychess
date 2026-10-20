'use client';

import { moveKey, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { Comment, MarksText, type CommentEditor } from './comment';
import { PANEL_LABEL } from './panel-styles';

export interface PositionBodyProps {
  /** The chapter's intro (R-66), shown at its root. */
  readonly intro: string | null;
  /** The current move, or null at the chapter's root. */
  readonly move: RepertoireMove | null;
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly commentEditor?: CommentEditor | undefined;
  /**
   * What the comment is called while browsing, a catalogue text: on a
   * coach's own repertoire a Comment is a Coach note. "Comment" if absent.
   */
  readonly commentLabel?: string | undefined;
  /**
   * The notes a view shows under a move's comment, given the move's key:
   * the owner's coach notes and Personal note, the coach's own note. None
   * when absent.
   */
  readonly renderNotes?: ((moveKey: string) => ReactNode) | undefined;
}

/**
 * The position section (docs/design/repertoire-screen.md): at the chapter
 * root its intro; on a move its comment, its marks as text for screen
 * readers, and what the view's `renderNotes` gives for the move.
 */
export function PositionBody({
  intro,
  move,
  commentEditor,
  commentLabel,
  renderNotes,
}: PositionBodyProps): JSX.Element | null {
  const t = useTranslations('repertoires.panel');
  if (move === null)
    return intro === null ? null : (
      <section aria-label={t('intro')} className="flex flex-col gap-1">
        <p className={PANEL_LABEL}>{t('intro')}</p>
        <p>{intro}</p>
      </section>
    );
  return (
    <section
      aria-label={commentLabel ?? t('comment')}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <Comment move={move} editor={commentEditor} label={commentLabel} />
        <MarksText move={move} />
      </div>
      {renderNotes?.(moveKey(move.from, move.san))}
    </section>
  );
}
