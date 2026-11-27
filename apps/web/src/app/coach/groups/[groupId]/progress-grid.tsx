import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath, coachProgressPath } from '../../../../lib/routes';
import type { GroupGrid } from '../../../../server/coach-pages';
import { SECTION_TITLE } from '../../../settings/styles';
import { CARD } from '../../../surfaces';
import { LastTrained, LastTrainedNote } from '../../last-trained';
import { GroupCell } from './group-cell';

/** One member's row of the grid. */
type MemberRow = GroupGrid['rows'][number];

const MEMBER_LINK = 'font-semibold break-words text-accent hover:underline';

/** The phone card's name link: a 44px touch target (Task 18). */
const CARD_MEMBER_LINK = `${MEMBER_LINK} inline-flex min-h-touch items-center`;

/**
 * The member's name, linked to their page; `className` sizes it: a touch
 * target on the phone card, inline in the grid's two-line clamp.
 */
function MemberLink({
  row,
  className = MEMBER_LINK,
}: {
  readonly row: MemberRow;
  readonly className?: string;
}): JSX.Element {
  return (
    <Link href={coachPlayerPath(row.player.id)} className={className}>
      {row.player.displayName}
    </Link>
  );
}

/** The member's standing on the grid's column `index`, linked to its progress. */
function MemberCell({
  row,
  grid,
  index,
}: {
  readonly row: MemberRow;
  readonly grid: GroupGrid;
  readonly index: number;
}): JSX.Element | null {
  const column = grid.columns[index];
  if (column === undefined) return null;
  return (
    <GroupCell
      cell={row.cells[index] ?? null}
      target={{
        href: coachProgressPath(row.player.id, column.id),
        name: row.player.displayName,
        repertoire: column.name,
      }}
    />
  );
}

/** One member on a phone: name and last trained, then a line per repertoire. */
function MemberCard({
  row,
  grid,
}: {
  readonly row: MemberRow;
  readonly grid: GroupGrid;
}): JSX.Element {
  return (
    <li className={`${CARD} flex flex-col gap-1 p-4`}>
      <span className="flex items-baseline justify-between gap-3">
        <MemberLink row={row} className={CARD_MEMBER_LINK} />
        <LastTrained days={row.lastTrainedDays} />
      </span>
      <ul className="flex flex-col">
        {grid.columns.map((column, index) => (
          <li
            key={column.id}
            className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border"
          >
            <span className="min-w-0 text-sm break-words">{column.name}</span>
            <MemberCell row={row} grid={grid} index={index} />
          </li>
        ))}
      </ul>
    </li>
  );
}

const CELL = 'p-2 align-top';

/**
 * A member row's cell: centred, so the name and Last trained line up with
 * the progress cell's 44px link (Task 18).
 */
const ROW_CELL = 'p-2 align-middle';

/**
 * The sticky player column, about 170px, its names held to two lines.
 * Its background is the card's, so cells scrolling under it are hidden.
 */
const PLAYER_COLUMN =
  'sticky left-0 z-10 w-[170px] min-w-[170px] bg-surface shadow-[inset_-1px_0_0_var(--color-border)]';
const PLAYER_CELL = `${CELL} ${PLAYER_COLUMN}`;

/** One member's row of the desktop grid, Last trained last. */
function GridTableRow({
  row,
  grid,
}: {
  readonly row: MemberRow;
  readonly grid: GroupGrid;
}): JSX.Element {
  return (
    <tr className="border-t border-border">
      <th scope="row" className={`${ROW_CELL} ${PLAYER_COLUMN} font-normal`}>
        <span className="line-clamp-2">
          <MemberLink row={row} />
        </span>
      </th>
      {grid.columns.map((column, index) => (
        <td key={column.id} className={ROW_CELL}>
          <MemberCell row={row} grid={grid} index={index} />
        </td>
      ))}
      <td className={`${ROW_CELL} whitespace-nowrap`}>
        <LastTrained days={row.lastTrainedDays} />
      </td>
    </tr>
  );
}

/** The grid from md: players down, the group's repertoires across. */
function GridTable({ grid }: { readonly grid: GroupGrid }): JSX.Element {
  const t = useTranslations('coach');
  return (
    <div className={`${CARD} hidden overflow-x-auto px-2 py-1 md:block`}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-fg-muted">
            <th scope="col" className={`${PLAYER_CELL} font-medium`}>
              {t('progress.player')}
            </th>
            {grid.columns.map((column) => (
              <th key={column.id} scope="col" className={`${CELL} font-medium`}>
                {column.name}
              </th>
            ))}
            <th scope="col" className={`${CELL} font-medium whitespace-nowrap`}>
              {t('players.column.lastTrained')}
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <GridTableRow key={row.player.id} row={row} grid={grid} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The group's progress, first on its page (spec, A group; R-153): a card
 * per member on a phone, a grid from md; each line or cell opens that
 * member's progress on that repertoire. Last trained counts only what the
 * coach can see, said once under it (R-154). Group members see none of
 * this (R-50).
 */
export function ProgressGrid({
  grid,
}: {
  readonly grid: GroupGrid;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('gridTitle')}
      </h2>
      {grid.columns.length === 0 ? (
        <p className="text-fg-muted">{t('gridEmpty')}</p>
      ) : (
        <>
          <ul
            aria-labelledby={titleId}
            className="flex flex-col gap-3 md:hidden"
          >
            {grid.rows.map((row) => (
              <MemberCard key={row.player.id} row={row} grid={grid} />
            ))}
          </ul>
          <GridTable grid={grid} />
          <LastTrainedNote />
        </>
      )}
    </section>
  );
}
