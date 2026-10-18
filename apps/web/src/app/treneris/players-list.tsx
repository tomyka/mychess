import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import { ConfirmedAction } from '../confirmed-action';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../nustatymai/styles';
import { unlinkPlayerAction } from './actions';

/** One linked player as the coach area lists them. */
export interface CoachPlayerRow {
  readonly id: string;
  readonly displayName: string;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
}

/** One player: the name (to their page), their groups, and Unlink. */
function PlayerRow({
  player,
}: {
  readonly player: CoachPlayerRow;
}): JSX.Element {
  const t = useTranslations('coach.players');
  const nameId = useId();
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
        {player.groups.length === 0
          ? t('noGroups')
          : t('groups', {
              groups: player.groups.map((group) => group.name).join(', '),
            })}
      </p>
      <ConfirmedAction
        action={unlinkPlayerAction}
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

/** The coach's linked players, by display name (R-12). */
export function PlayersList({
  players,
}: {
  readonly players: readonly CoachPlayerRow[];
}): JSX.Element {
  const t = useTranslations('coach.players');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      {players.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} />
          ))}
        </ul>
      )}
    </section>
  );
}
