import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachGroupPath } from '../../../../lib/routes';
import { DISPLAY_TIME_ZONE } from '../../../../lib/time-zone';
import { ConfirmedAction } from '../../../confirmed-action';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../../../nustatymai/styles';
import { unlinkPlayerAction } from '../../actions';
import { COACH_PAGE, SubpageHeader } from '../../subpage-header';

/**
 * What the coach sees of a linked player (subject `profile`): the display
 * name, when they linked and the coach's own groups; never the email.
 */
export interface CoachPlayerPageData {
  readonly id: string;
  readonly displayName: string;
  readonly linkedAt: Date;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
}

/** The coach's groups the player is in, each to its page. */
function PlayerGroups({
  groups,
}: {
  readonly groups: CoachPlayerPageData['groups'];
}): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('player.groupsTitle')}
      </h2>
      {groups.length === 0 ? (
        <p className="text-fg-muted">{t('players.noGroups')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.id}>
              <Link href={coachGroupPath(group.id)} className={TEXT_LINK}>
                {group.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One linked player's page in the coach dashboard (plan decision 11). */
export function PlayerView({
  player,
}: {
  readonly player: CoachPlayerPageData;
}): JSX.Element {
  const t = useTranslations('coach');
  const format = useFormatter();
  const nameId = useId();
  const date = format.dateTime(player.linkedAt, {
    dateStyle: 'medium',
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <main className={COACH_PAGE}>
      <SubpageHeader title={player.displayName} titleId={nameId}>
        <p className="text-fg-muted">{t('player.linkedSince', { date })}</p>
      </SubpageHeader>
      <PlayerGroups groups={player.groups} />
      <ConfirmedAction
        action={unlinkPlayerAction}
        fields={{ playerId: player.id }}
        describedBy={nameId}
        label={t('players.unlink')}
        question={t('players.unlinkConfirm', { name: player.displayName })}
        confirm={t('players.confirmUnlink')}
        cancel={t('players.cancel')}
      />
    </main>
  );
}
