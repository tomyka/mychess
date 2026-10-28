import type { Standing } from '@mychess/chess';
import type { GroupProgressCell } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath, coachProgressPath } from '../../../../lib/routes';
import type { GroupGrid } from '../../../../server/coach-pages';
import { AssignmentBadges } from '../../../assignment-badges';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../../../nustatymai/styles';
import { LastTrained } from '../../last-trained';
import { MasteredBadge, usePercentLearned } from '../../state-bar';

/**
 * The sticky player column. Its background is the section's: the page
 * colour on a phone, the card's from `sm` (SECTION), so cells scrolling
 * under it are hidden in both themes.
 */
const STICKY =
  'sticky left-0 z-10 bg-bg p-2 shadow-[inset_-1px_0_0_var(--color-border)] sm:bg-surface';

/** Which player and repertoire a cell is about, to name its link. */
interface CellTarget {
  readonly href: string;
  readonly name: string;
  readonly repertoire: string;
}

/**
 * % learned and the due count (none when there is nothing to learn): a link
 * to the player's progress page, named with the player and the repertoire
 * around its visible text (WCAG 2.5.3).
 */
function CellLink({
  standing,
  target,
}: {
  readonly standing: Standing;
  readonly target: CellTarget;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const percent = usePercentLearned(standing.counts);
  const due = percent.empty ? null : t('cellDue', { due: standing.counts.due });
  const who = { name: target.name, repertoire: target.repertoire };
  const label =
    due === null
      ? t('cellLabelNothing', { ...who, nothing: percent.text })
      : t('cellLabel', { ...who, percent: percent.text, due });
  return (
    <Link
      href={target.href}
      aria-label={label}
      className="flex min-h-touch flex-col justify-center text-accent underline"
    >
      <span>{percent.text}</span>
      {due === null ? null : <span className="text-sm">{due}</span>}
    </Link>
  );
}

/**
 * One member's cell: "not assigned", or the badges with % learned, due and
 * Mastered. A forked assignment shows its badge only (R-155).
 */
function Cell({
  cell,
  target,
}: {
  readonly cell: GroupProgressCell | null;
  readonly target: CellTarget;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  if (cell === null) {
    return <span className="text-fg-muted">{t('noAssignment')}</span>;
  }
  const { view } = cell;
  return (
    <div className="flex flex-col gap-1">
      {view.kind === 'forked' ? null : (
        <CellLink standing={view.standing} target={target} />
      )}
      <AssignmentBadges flags={cell.badges} />
      {view.kind === 'granted' && view.standing.mastered ? (
        <MasteredBadge />
      ) : null}
    </div>
  );
}

/** The table itself: a column per repertoire, a row per member. */
function GridTable({ grid }: { readonly grid: GroupGrid }): JSX.Element {
  const t = useTranslations('coach.progress');
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className={STICKY}>
              {t('player')}
            </th>
            {grid.columns.map((column) => (
              <th key={column.id} scope="col" className="min-w-36 p-2">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr
              key={row.player.id}
              className="border-t border-border align-top"
            >
              <th scope="row" className={`${STICKY} min-w-32 font-normal`}>
                <Link
                  href={coachPlayerPath(row.player.id)}
                  className={`${TEXT_LINK} break-words`}
                >
                  {row.player.displayName}
                </Link>
                <LastTrained days={row.lastTrainedDays} />
              </th>
              {grid.columns.map((column, i) => (
                <td key={column.id} className="p-2">
                  <Cell
                    cell={row.cells[i] ?? null}
                    target={{
                      href: coachProgressPath(row.player.id, column.id),
                      name: row.player.displayName,
                      repertoire: column.name,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Players x the group's repertoires (R-153). On a phone the table scrolls
 * sideways with the player column fixed; the page itself never scrolls
 * sideways. Group members see none of this (R-50): it is the coach's page.
 * Translations and useId only, so the client GroupView can render it; the
 * loader module is imported for its type only.
 */
export function ProgressGrid({
  grid,
}: {
  readonly grid: GroupGrid;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('gridTitle')}
      </h2>
      {grid.columns.length === 0 ? (
        <p className="text-fg-muted">{t('gridEmpty')}</p>
      ) : (
        <GridTable grid={grid} />
      )}
    </section>
  );
}
