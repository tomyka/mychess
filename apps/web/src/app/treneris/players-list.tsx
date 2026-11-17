'use client';

import type { AccountRef, BadgeSet } from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import { MEDIUM_DATE } from '../../lib/date-format';
import { AssignmentBadges } from '../assignment-badges';
import { ConfirmedAction } from '../confirmed-action';
import { useDeadline } from '../use-deadline';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../nustatymai/styles';
import { unlinkPlayerAction, type CoachActionState } from './actions';
import { LastTrained } from './last-trained';
import { RefusalLine } from './refusal-line';

/** One linked player as the coach dashboard lists them. */
export interface CoachPlayerRow extends AccountRef {
  readonly groups: readonly { readonly id: string; readonly name: string }[];
  /** Whole Vilnius days since the player last trained; null for never (R-154). */
  readonly lastTrainedDays: number | null;
  /** When the player linked: it tells two of the same name apart (#329). */
  readonly linkedAt: Date;
  /**
   * The earliest deadline, `YYYY-MM-DD`, of this coach's live assignments
   * to the player not yet done; null for none (#329).
   */
  readonly nearestDeadline: string | null;
  /** One of those assignments is overdue (R-51). */
  readonly overdue: boolean;
}

/** Only the Overdue badge on, as assignments show it (R-51). */
const OVERDUE: BadgeSet = {
  overdue: true,
  paused: false,
  forked: false,
  updated: false,
};

/**
 * Whether the player is overdue (#329): the Overdue badge, else the
 * nearest deadline; nothing without one.
 */
function DeadlineSignal({
  player,
}: {
  readonly player: CoachPlayerRow;
}): JSX.Element | null {
  const t = useTranslations('assignment');
  const date = useDeadline();
  if (player.overdue) return <AssignmentBadges flags={OVERDUE} />;
  if (player.nearestDeadline === null) return null;
  return (
    <p className="text-sm">
      {t('deadlineOn', { date: date(player.nearestDeadline) })}
    </p>
  );
}

const INITIAL: CoachActionState = {};

/** "Linked since", which tells two players of the same name apart (#329). */
function LinkedSince({ at }: { readonly at: Date }): JSX.Element {
  const t = useTranslations('coach.player');
  const format = useFormatter();
  const date = format.dateTime(at, MEDIUM_DATE);
  return <p className="text-sm text-fg-muted">{t('linkedSince', { date })}</p>;
}

/**
 * One player: the name (to their page), when they linked, their groups,
 * last trained, and Unlink kept quiet (#329).
 */
function PlayerRow({
  player,
  unlink,
}: {
  readonly player: CoachPlayerRow;
  readonly unlink: (form: FormData) => void;
}): JSX.Element {
  const t = useTranslations('coach.players');
  const format = useFormatter();
  const nameId = useId();
  const groups = player.groups.map((group) => group.name);
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col">
        <Link
          id={nameId}
          href={coachPlayerPath(player.id)}
          className={`${TEXT_LINK} text-lg font-semibold`}
        >
          {player.displayName}
        </Link>
        <LinkedSince at={player.linkedAt} />
      </div>
      <DeadlineSignal player={player} />
      <p className="text-sm text-fg-muted">
        {groups.length === 0
          ? t('noGroups')
          : t('groups', {
              groups: format.list(groups, { type: 'conjunction' }),
            })}
      </p>
      <LastTrained days={player.lastTrainedDays} />
      <ConfirmedAction
        action={unlink}
        fields={{ playerId: player.id }}
        describedBy={nameId}
        label={t('unlink')}
        question={t('unlinkConfirm', { name: player.displayName })}
        confirm={t('confirmUnlink')}
        cancel={t('cancel')}
        quiet
      />
    </li>
  );
}

/** The coach's linked players, by display name (R-12); a refused Unlink. */
export function PlayersList({
  players,
}: {
  readonly players: readonly CoachPlayerRow[];
}): JSX.Element {
  const t = useTranslations('coach.players');
  const titleId = useId();
  const [state, unlink] = useActionState(unlinkPlayerAction, INITIAL);
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <RefusalLine state={state} />
      {players.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} unlink={unlink} />
          ))}
        </ul>
      )}
    </section>
  );
}
