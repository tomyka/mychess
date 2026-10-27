'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import type { SharedRepertoireItem } from '@mychess/db';
import type { AccountRef } from '@mychess/domain';
import {
  coachGroupPath,
  coachSharedRepertoirePath,
} from '../../../../lib/routes';
import { DISPLAY_TIME_ZONE } from '../../../../lib/time-zone';
import type { PlayerProgressSection } from '../../../../server/coach-progress';
import { ConfirmedAction } from '../../../confirmed-action';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../../../nustatymai/styles';
import { unlinkPlayerAction, type CoachActionState } from '../../actions';
import { RefusalLine } from '../../refusal-line';
import { COACH_PAGE, SubpageHeader } from '../../subpage-header';
import { ProgressSection } from './progress-section';

/**
 * What the coach sees of a linked player (subject `profile`): the display
 * name, when they linked and the coach's own groups; never the email.
 */
export interface CoachPlayerPageData extends AccountRef {
  readonly linkedAt: Date;
  readonly groups: readonly { readonly id: string; readonly name: string }[];
  /** The player's repertoires shared with this coach (R-42). */
  readonly repertoires: readonly SharedRepertoireItem[];
  /** Where the player stands on each repertoire the coach may see (S7). */
  readonly progress: PlayerProgressSection;
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

/** The player's repertoires shared with the coach, each to its read-only page. */
function SharedRepertoires({
  player,
}: {
  readonly player: CoachPlayerPageData;
}): JSX.Element {
  const t = useTranslations();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('coach.shared.title')}
      </h2>
      {player.repertoires.length === 0 ? (
        <p className="text-fg-muted">
          {t('coach.shared.empty', { name: player.displayName })}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {player.repertoires.map((repertoire) => (
            <li key={repertoire.id}>
              <Link
                href={coachSharedRepertoirePath(player.id, repertoire.id)}
                className="flex min-h-touch flex-col justify-center"
              >
                <span className="text-accent underline">{repertoire.name}</span>
                <span className="text-sm text-fg-muted">
                  {repertoire.side === 'white'
                    ? t('repertoires.list.white')
                    : t('repertoires.list.black')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const INITIAL: CoachActionState = {};

/** One linked player's page in the coach dashboard (plan decision 11). */
export function PlayerView({
  player,
}: {
  readonly player: CoachPlayerPageData;
}): JSX.Element {
  const t = useTranslations('coach');
  const format = useFormatter();
  const nameId = useId();
  const [state, unlink] = useActionState(unlinkPlayerAction, INITIAL);
  const date = format.dateTime(player.linkedAt, {
    dateStyle: 'medium',
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <main className={COACH_PAGE}>
      <SubpageHeader title={player.displayName} titleId={nameId}>
        <p className="text-fg-muted">{t('player.linkedSince', { date })}</p>
      </SubpageHeader>
      <ProgressSection player={player} progress={player.progress} />
      <SharedRepertoires player={player} />
      <PlayerGroups groups={player.groups} />
      <RefusalLine state={state} />
      <ConfirmedAction
        action={unlink}
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
