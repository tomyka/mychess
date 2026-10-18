'use client';

import type {
  ChapterName,
  RepertoireSummary,
  Side,
  Skipped,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useId, useState, type JSX, type RefObject } from 'react';
import type { ImportPreview } from '../../../server/import-preview';
import { SECONDARY_BUTTON } from '../../buttons';
import { SECTION_TITLE } from '../../nustatymai/styles';
import { StatusLine } from '../../status-line';
import { StepNumber } from './file-step';

/** Skipped games shown before "Show all" (docs/design/repertoire-screen.md). */
const SKIPPED_SHOWN = 10;

const COUNTS = [
  'chapters',
  'lines',
  'positions',
  'transpositions',
  'moves',
] as const satisfies readonly (keyof RepertoireSummary)[];

const SUBTITLE = 'text-base font-semibold';

/** The five counts, each tile one text run ("6 chapters") so it reads right. */
function CountTiles({
  summary,
}: {
  readonly summary: RepertoireSummary;
}): JSX.Element {
  const t = useTranslations('repertoires.import.summary');
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {COUNTS.map((count) => (
        <li
          key={count}
          className="rounded-card bg-sunken p-3 text-center text-lg font-semibold tabular-nums"
        >
          {t(count, { count: summary[count] })}
        </li>
      ))}
    </ul>
  );
}

function ChapterNames({
  names,
}: {
  readonly names: readonly ChapterName[];
}): JSX.Element {
  const t = useTranslations();
  const titleId = useId();
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className={SUBTITLE}>
        {t('repertoires.import.chaptersTitle')}
      </h3>
      <ol aria-labelledby={titleId} className="list-decimal pl-6">
        {names.map((name, index) => (
          <li key={index} className="line-clamp-2">
            {name.kind === 'text'
              ? name.text
              : t(name.key, { number: name.number })}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The move a skip names, in the notation players read ("5...a6", "Nxe4"). */
function skippedMove(skipped: Skipped, side: Side): string | undefined {
  if (skipped.reason !== 'pgn.secondAnswer') return skipped.san;
  const dots = side === 'black' ? '...' : '. ';
  return `${String(skipped.move)}${dots}${skipped.san}`;
}

function SkippedItem({
  skipped,
  side,
}: {
  readonly skipped: Skipped;
  readonly side: Side;
}): JSX.Element {
  const t = useTranslations();
  const reason = t(skipped.reason);
  const move = skippedMove(skipped, side);
  return (
    <li>
      {move === undefined
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
  side,
}: {
  readonly skipped: readonly Skipped[];
  readonly side: Side;
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
          <SkippedItem key={index} skipped={item} side={side} />
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

export interface ImportSummaryProps {
  readonly preview: ImportPreview;
  /** The upload's side, which decides how a skipped answer is written. */
  readonly side: Side;
  /** The preview is re-running against another target. */
  readonly busy: boolean;
  /** Focused after a preview so the summary is read next. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

/** Step 2: what the file holds (R-64), or the merge with the chosen repertoire. */
export function ImportSummary({
  preview,
  side,
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
      <CountTiles summary={preview.summary} />
      <ChapterNames names={preview.chapters} />
      {preview.skipped.length === 0 ? (
        <StatusLine
          text={t('skippedNone', { count: preview.chapters.length })}
          tone="success"
        />
      ) : (
        <SkippedGames skipped={preview.skipped} side={side} />
      )}
    </section>
  );
}
