'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import { ConfirmedAction } from '../confirmed-action';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../nustatymai/styles';
import { unlinkPlayerAction, type CoachActionState } from './actions';
import { RefusalLine } from './refusal-line';

/** One linked player as the coach dashboard lists them. */
export interface CoachPlayerRow {
  readonly id: string;
  readonly displayName: string;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
}

const INITIAL: CoachActionState = {};

/** One player: the name (to their page), their groups, and Unlink. */
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
      <Link
        id={nameId}
        href={coachPlayerPath(player.id)}
        className={`${TEXT_LINK} text-lg font-semibold`}
      >
        {player.displayName}
      </Link>
      <p className="text-fg-muted">
        {groups.length === 0
          ? t('noGroups')
          : t('groups', {
              groups: format.list(groups, { type: 'conjunction' }),
            })}
      </p>
      <ConfirmedAction
        action={unlink}
        fields={{ playerId: player.id }}
        describedBy={nameId}
        label={t('unlink')}
        question={t('unlinkConfirm', { name: player.displayName })}
        confirm={t('confirmUnlink')}
        cancel={t('cancel')}
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
