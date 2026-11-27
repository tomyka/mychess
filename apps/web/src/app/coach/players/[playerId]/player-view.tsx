'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useActionState, useId, type JSX } from 'react';
import { coachGroupPath } from '../../../../lib/routes';
import type { CoachPlayerPage } from '../../../../server/coach-pages';
import { ConfirmedAction } from '../../../confirmed-action';
import { TEXT_LINK } from '../../../settings/styles';
import { useShortInstant } from '../../../use-deadline';
import { unlinkPlayerAction, type CoachActionState } from '../../actions';
import { LastTrainedNote, useTrainedWhen } from '../../last-trained';
import { RefusalLine } from '../../refusal-line';
import { COACH_PAGE, SubpageHeader } from '../../subpage-header';
import { RepertoireCards } from './repertoire-cards';

/** "trained 5 days ago", or "never trained" (R-154; the footnote says what it counts). */
function useTrained(days: number | null): string {
  const t = useTranslations('coach.player');
  const when = useTrainedWhen();
  return days === null ? t('neverTrained') : t('trained', { when: when(days) });
}

/**
 * The line under the name: when the player last trained, since when they
 * are linked, and the coach's own groups they are in, each to its page.
 */
function MetaLine({
  player,
}: {
  readonly player: CoachPlayerPage;
}): JSX.Element {
  const t = useTranslations('coach');
  const date = useShortInstant(player.today);
  const parts = [
    <span key="trained">{useTrained(player.lastTrainedDays)}</span>,
    <span key="linked">
      {t('player.linkedSince', { date: date(player.linkedAt) })}
    </span>,
    ...player.groups.map((group) => (
      <Link
        key={group.id}
        href={coachGroupPath(group.id)}
        className={TEXT_LINK}
      >
        {group.name}
      </Link>
    )),
  ];
  return (
    <p className="text-sm text-fg-muted">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index === 0 ? null : t('progress.separator')}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

const INITIAL: CoachActionState = {};

/**
 * Unlink, in the error tone with its confirmation (R-44). It is rendered
 * once, last in the page, so it comes last in reading and focus order; on
 * a phone that is the bottom, and from md the page's grid places it at the
 * right of the title.
 */
function Unlink({
  player,
  nameId,
}: {
  readonly player: CoachPlayerPage;
  readonly nameId: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const [state, unlink] = useActionState(unlinkPlayerAction, INITIAL);
  return (
    <div className="flex flex-col gap-3 md:col-start-2 md:row-start-1 md:max-w-xs md:items-end">
      <ConfirmedAction
        action={unlink}
        fields={{ playerId: player.id }}
        describedBy={nameId}
        look="danger"
        label={t('player.unlink', { name: player.displayName })}
        question={t('players.unlinkConfirm', { name: player.displayName })}
        confirm={t('players.confirmUnlink')}
        cancel={t('players.cancel')}
      />
      <RefusalLine state={state} />
    </div>
  );
}

/**
 * One linked player's page (spec, A player): the name and one meta line,
 * a card per repertoire the coach may see, the last-trained footnote, and
 * Unlink.
 */
export function PlayerView({
  player,
}: {
  readonly player: CoachPlayerPage;
}): JSX.Element {
  const nameId = useId();
  return (
    <main
      className={`${COACH_PAGE} md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start`}
    >
      <SubpageHeader title={player.displayName} titleId={nameId}>
        <MetaLine player={player} />
      </SubpageHeader>
      <div className="flex flex-col gap-3 md:col-span-2">
        <RepertoireCards player={player} />
        <LastTrainedNote />
      </div>
      <Unlink player={player} nameId={nameId} />
    </main>
  );
}
