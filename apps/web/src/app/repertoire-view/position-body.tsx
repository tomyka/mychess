'use client';

import { moveKey, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { CommentField, MarksText, type CommentEditor } from './comment';
import { IntroText } from './intro-text';
import { PANEL_LABEL } from './panel-styles';
import type { ScreenState } from './screen-state';

export interface PositionEditProps {
  /** The chapter's intro (R-66), shown at its root in builder mode. */
  readonly intro: string | null;
  /** The current move, or null at the chapter's root. */
  readonly move: RepertoireMove | null;
  /**
   * In builder mode the intro and the comment field are here; while
   * browsing the comment strip shows both (spec, Comment strip).
   */
  readonly mode: ScreenState['mode'];
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly commentEditor?: CommentEditor | undefined;
}

export interface PositionBodyProps {
  /** The current move, or null at the chapter's root. */
  readonly move: RepertoireMove | null;
  /**
   * The notes a view shows under a move, given the move's key: the owner's
   * coach notes and Personal note, the coach's own note. None when absent.
   */
  readonly renderNotes?: ((moveKey: string) => ReactNode) | undefined;
}

/** The chapter's intro, read-only in builder mode too (R-112). */
function Intro({ intro }: { readonly intro: string }): JSX.Element {
  const t = useTranslations('repertoires.panel');
  return (
    <section aria-label={t('intro')} className="flex flex-col gap-1">
      <p className={PANEL_LABEL}>{t('intro')}</p>
      <p>
        <IntroText intro={intro} />
      </p>
    </section>
  );
}

/**
 * What builder mode puts above the move list (docs/design/repertoire-screen.md):
 * the comment field on a move, the chapter's intro at its root. Nothing
 * while browsing, where the comment strip shows both.
 */
export function PositionEdit({
  intro,
  move,
  mode,
  commentEditor,
}: PositionEditProps): JSX.Element | null {
  if (mode !== 'build') return null;
  if (move === null) return intro === null ? null : <Intro intro={intro} />;
  if (commentEditor === undefined) return null;
  return (
    <CommentField
      key={moveKey(move.from, move.san)}
      move={move}
      editor={commentEditor}
    />
  );
}

/**
 * The position under the move list and Train here: on a move its marks as
 * text for screen readers and what the view's `renderNotes` gives for the
 * move (spec, "My note follows"). Nothing at the chapter root.
 */
export function PositionBody({
  move,
  renderNotes,
}: PositionBodyProps): JSX.Element | null {
  if (move === null) return null;
  const key = moveKey(move.from, move.san);
  return (
    <div className="flex flex-col gap-3">
      <MarksText move={move} />
      {renderNotes?.(key)}
    </div>
  );
}
