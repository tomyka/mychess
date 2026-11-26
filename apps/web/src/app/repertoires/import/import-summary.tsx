'use client';

import type { RepertoireSummary, Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useId, useState, type JSX, type RefObject } from 'react';
import type {
  AddedAnnotation,
  ImportPreview,
  RenamedChapter,
  SkippedGame,
} from '../../../server/import-preview';
import { SECONDARY_BUTTON } from '../../buttons';
import { SECTION_TITLE } from '../../settings/styles';
import { StatusLine } from '../../status-line';
import { StepNumber } from './step-number';

/** Skipped games shown before "Show all" (docs/design/repertoire-screen.md). */
const SKIPPED_SHOWN = 10;

/** Added comments shown before "Show all", as for skipped games. */
const ADDED_SHOWN = 10;

/** The counts the summary line reads, in order; positions only repeat moves. */
const COUNTS = [
  'chapters',
  'lines',
  'moves',
  'transpositions',
] as const satisfies readonly (keyof RepertoireSummary)[];

const SUBTITLE = 'text-base font-semibold';

/**
 * What the file holds as one line: "6 chapters · 13 lines · 123 moves ·
 * 1 transposition", leaving out transpositions when there are none.
 */
function CountsLine({
  summary,
}: {
  readonly summary: RepertoireSummary;
}): JSX.Element {
  const t = useTranslations('repertoires.import.summary');
  const shown = COUNTS.filter(
    (count) => count !== 'transpositions' || summary[count] > 0,
  );
  return (
    <p className="text-fg-muted tabular-nums">
      {shown.map((count) => t(count, { count: summary[count] })).join(' · ')}
    </p>
  );
}

/**
 * The chapters it brings. Merged into a repertoire they are only those the
 * merge adds, fewer than the stats line's (the file's), and the title says
 * so (sign-off #381 part 4).
 */
function ChapterNames({
  names,
  merge,
}: {
  readonly names: readonly string[];
  readonly merge: boolean;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className={SUBTITLE}>
        {t(merge ? 'chaptersAdded' : 'chaptersTitle')}
      </h3>
      <ol aria-labelledby={titleId} className="list-decimal space-y-1 pl-6">
        {names.map((name, index) => (
          // Wrapped in full, not clamped: a distinction at the end of a
          // long title must show (R-158).
          <li key={index} className="break-words">
            {name}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The target's chapters the merge renames, old title and new (R-159), each
 * wrapped in full like the chapter list.
 */
function RenamedChapters({
  renamed,
}: {
  readonly renamed: readonly RenamedChapter[];
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className={SUBTITLE}>
        {t('renamedTitle')}
      </h3>
      <ul aria-labelledby={titleId} className="list-disc space-y-1 pl-6">
        {renamed.map(({ from, to }, index) => (
          <li key={index} className="break-words">
            {t('renamedItem', { from, to })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The comments and NAGs a merge adds to moves the target already has
 * (R-176): each move with the glyphs it gains (R-175) and its new comment,
 * the first ten and the rest on request.
 */
function AddedAnnotations({
  added,
}: {
  readonly added: readonly AddedAnnotation[];
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  const [all, setAll] = useState(false);
  const shown = all ? added : added.slice(0, ADDED_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className={SUBTITLE}>
        {t('annotationsTitle', { count: added.length })}
      </h3>
      <ul aria-labelledby={titleId} className="list-disc space-y-1 pl-6">
        {shown.map(({ move, comment }, index) => (
          <li key={index} className="break-words">
            {comment === null ? move : t('annotationItem', { move, comment })}
          </li>
        ))}
      </ul>
      {shown.length < added.length ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
          }}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('annotationsAll', { count: added.length })}
        </button>
      ) : null}
    </div>
  );
}

function SkippedItem({
  skipped,
}: {
  readonly skipped: SkippedGame;
}): JSX.Element {
  const t = useTranslations();
  const reason = t(skipped.reason);
  const move = skipped.moveText;
  return (
    <li>
      {move === null
        ? t('repertoires.import.skippedItem', { game: skipped.game, reason })
        : t('repertoires.import.skippedMove', {
            game: skipped.game,
            reason,
            move,
          })}
    </li>
  );
}

/** The games left out (R-64): the first ten, and the rest on request. */
function SkippedGames({
  skipped,
}: {
  readonly skipped: readonly SkippedGame[];
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  const [all, setAll] = useState(false);
  const shown = all ? skipped : skipped.slice(0, SKIPPED_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className={SUBTITLE}>
        {t('skippedTitle', { count: skipped.length })}
      </h3>
      <ol
        aria-labelledby={titleId}
        className="flex flex-col gap-1 rounded-card bg-error-subtle p-3 text-error"
      >
        {shown.map((item, index) => (
          <SkippedItem key={index} skipped={item} />
        ))}
      </ol>
      {shown.length < skipped.length ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
          }}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('skippedAll', { count: skipped.length })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The side looks wrong (#364, R-214): most games lost second answers and
 * the other side would lose fewer. The switch previews the file again as
 * `suggested`; without one (the side is fixed) the warning stands alone.
 */
function SideWarning({
  suggested,
  onSwitch,
}: {
  readonly suggested: Side;
  readonly onSwitch: ((side: Side) => void) | undefined;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  return (
    <div className="flex flex-col gap-3 rounded-card bg-sunken p-4">
      <p>{t('sideWarning', { side: suggested })}</p>
      {onSwitch === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            onSwitch(suggested);
          }}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('sideSwitch', { side: suggested })}
        </button>
      )}
    </div>
  );
}

export interface ImportSummaryProps {
  readonly preview: ImportPreview;
  /** Previews the file again as the other side; none when the side is fixed. */
  readonly onSwitchSide?: (side: Side) => void;
  /** The preview is re-running against another target. */
  readonly busy: boolean;
  /** Focused after a preview so the summary is read next. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

/**
 * The chapters it brings, the existing ones it renames, the comments and
 * NAGs it adds, and how many games were read.
 */
function Accepted({
  preview,
}: {
  readonly preview: ImportPreview;
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  return (
    <>
      {preview.chapters.length === 0 ? null : (
        <ChapterNames
          names={preview.chapters}
          merge={preview.target !== null}
        />
      )}
      {preview.renamed.length === 0 ? null : (
        <RenamedChapters renamed={preview.renamed} />
      )}
      {preview.annotations.length === 0 ? null : (
        <AddedAnnotations added={preview.annotations} />
      )}
      {preview.skipped.length === 0 ? (
        // The file's games, as the stats line counts them, whichever the
        // destination: the merge's own count is "Chapters it adds".
        <StatusLine
          text={t('skippedNone', { count: preview.summary.chapters })}
          tone="success"
        />
      ) : null}
    </>
  );
}

/**
 * Step 2: what the file holds (R-64), the same for a new repertoire and a
 * merge, and what the merge with the chosen repertoire brings. When nothing
 * can be added (R-115) it shows the counts and the games left out and why;
 * the refusal itself is step 3's status line.
 */
export function ImportSummary({
  preview,
  onSwitchSide,
  busy,
  headingRef,
}: ImportSummaryProps): JSX.Element {
  const t = useTranslations('repertoires.import');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy ? true : undefined}
      className={`flex flex-col gap-4 ${busy ? 'opacity-60' : ''}`}
    >
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={SECTION_TITLE}>
        <StepNumber n={2} />
        {t('summaryTitle')}
      </h2>
      {preview.suggestedSide === null ? null : (
        <SideWarning
          suggested={preview.suggestedSide}
          onSwitch={onSwitchSide}
        />
      )}
      <CountsLine summary={preview.summary} />
      {preview.refusal === null ? <Accepted preview={preview} /> : null}
      {preview.skipped.length === 0 ? null : (
        <SkippedGames skipped={preview.skipped} />
      )}
    </section>
  );
}
