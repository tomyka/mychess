import { percentLearned, type ProgressCounts } from '@mychess/chess';
import type { PlayerSummary } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX, type ReactNode } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import type { DashboardPlayerLine } from '../../server/coach-pages';
import { Pill } from '../pill';
import { SECTION_TITLE } from '../settings/styles';
import { CARD } from '../surfaces';
import { useShortDeadline } from '../use-deadline';
import { LastTrained, LastTrainedNote } from './last-trained';
import { ROW_LINK } from './row-link';
import { StateBar } from './state-bar';

/** The bar beside "N% learned" (R-231); the bar alone says an empty one. */
function Learned({
  counts,
  barWidth,
}: {
  readonly counts: ProgressCounts;
  readonly barWidth: string;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(counts);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`${barWidth} shrink-0`}>
        <StateBar counts={counts} size="row" />
      </span>
      {percent === null ? null : <span>{t('percent', { percent })}</span>}
    </span>
  );
}

/**
 * The due count in the due tone above zero (R-231): "43 due" in a row,
 * where a zero is left out; the number alone in its table column.
 */
function Due({
  counts,
  form,
}: {
  readonly counts: ProgressCounts | null;
  readonly form: 'row' | 'cell';
}): JSX.Element | null {
  const t = useTranslations('coach.progress.part');
  if (counts === null || (form === 'row' && counts.due === 0)) return null;
  return (
    <span className={counts.due > 0 ? 'text-due' : 'text-fg-muted'}>
      {form === 'row' ? t('due', { count: counts.due }) : counts.due}
    </span>
  );
}

/**
 * Where the player's assignments stand: Overdue, Done when every one is,
 * else the next deadline ("by Nov 30" in a row, the date alone in its
 * table column); nothing without one.
 */
function Deadline({
  summary,
  today,
  form,
}: {
  readonly summary: PlayerSummary;
  readonly today: string;
  readonly form: 'row' | 'cell';
}): JSX.Element | null {
  const t = useTranslations('coach');
  const badge = useTranslations('assignment.badge');
  const date = useShortDeadline(today);
  if (summary.overdue) return <Pill tone="overdue">{badge('overdue')}</Pill>;
  if (summary.allDone) return <Pill tone="done">{t('status.done')}</Pill>;
  if (summary.nextDeadline === null) return null;
  const on = date(summary.nextDeadline);
  return (
    <span className="text-fg-muted">
      {form === 'row' ? t('players.by', { date: on }) : on}
    </span>
  );
}

/** One player on a phone: name and last trained, then their progress. */
function PlayerRow({
  player,
  today,
}: {
  readonly player: DashboardPlayerLine;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const { counts } = player.summary;
  return (
    <li className="relative flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <span className="flex items-baseline justify-between gap-3">
        <Link href={coachPlayerPath(player.id)} className={ROW_LINK}>
          {player.displayName}
        </Link>
        <LastTrained days={player.lastTrainedDays} form="short" />
      </span>
      {counts === null ? (
        <span className="text-sm text-fg-muted">{t('players.nothing')}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <Learned counts={counts} barWidth="w-16" />
          <Due counts={counts} form="row" />
          <Deadline summary={player.summary} today={today} form="row" />
        </span>
      )}
    </li>
  );
}

const CELL = 'px-3 py-2 first:pl-0 last:pr-0';

/** A cell that never wraps; only the player's name does. */
const FIXED_CELL = `${CELL} whitespace-nowrap`;

/** One player in the desktop table; the whole row links to their page. */
function PlayerTableRow({
  player,
  today,
}: {
  readonly player: DashboardPlayerLine;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach.players');
  const { counts } = player.summary;
  return (
    <tr className="relative border-t border-border">
      <td className={CELL}>
        <Link href={coachPlayerPath(player.id)} className={ROW_LINK}>
          {player.displayName}
        </Link>
      </td>
      <td className={`${FIXED_CELL} text-fg-muted`}>
        {counts === null ? (
          t('nothing')
        ) : (
          <Learned counts={counts} barWidth="w-16" />
        )}
      </td>
      <td className={FIXED_CELL}>
        <Due counts={counts} form="cell" />
      </td>
      <td className={FIXED_CELL}>
        <Deadline summary={player.summary} today={today} form="cell" />
      </td>
      <td className={FIXED_CELL}>
        <LastTrained days={player.lastTrainedDays} form="short" />
      </td>
    </tr>
  );
}

const COLUMNS = [
  'player',
  'progress',
  'due',
  'nextDeadline',
  'lastTrained',
] as const;

/** The players as a table from md (spec, The dashboard). */
function PlayersTable({
  players,
  today,
}: {
  readonly players: readonly DashboardPlayerLine[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach.players.column');
  return (
    <table className="hidden w-full text-left text-sm md:table">
      <thead>
        <tr className="text-fg-muted">
          {COLUMNS.map((column) => (
            <th
              key={column}
              scope="col"
              className={`${FIXED_CELL} font-medium`}
            >
              {t(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <PlayerTableRow key={player.id} player={player} today={today} />
        ))}
      </tbody>
    </table>
  );
}

/**
 * Every linked player, by name (R-160), one compact row each (R-231): a
 * list on a phone, a table from md. Unlink is on the player's page. With
 * no player yet, `invite` (the Invite a player button) follows the line
 * that says so.
 */
export function PlayersList({
  players,
  today,
  invite,
}: {
  readonly players: readonly DashboardPlayerLine[];
  readonly today: string;
  readonly invite?: ReactNode;
}): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('sectionCount', {
          title: t('players.title'),
          count: players.length,
        })}
      </h2>
      {players.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-fg-muted">{t('players.empty')}</p>
          {invite}
        </div>
      ) : (
        <>
          <div className={`${CARD} px-4 md:py-2`}>
            <ul className="flex flex-col md:hidden">
              {players.map((player) => (
                <PlayerRow key={player.id} player={player} today={today} />
              ))}
            </ul>
            <PlayersTable players={players} today={today} />
          </div>
          <LastTrainedNote />
        </>
      )}
    </section>
  );
}
