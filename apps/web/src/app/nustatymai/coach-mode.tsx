'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { PendingButton } from '../pending-button';
import { StatusLine } from '../status-line';
import {
  startCoachingAction,
  stopCoachingAction,
  type LinkedPlayer,
  type StopCoachingState,
} from './coaching-actions';
import { SECTION, SECTION_TITLE, TEXT_LINK } from './styles';

const INITIAL: StopCoachingState = {};

/** The players a coach must unlink before Coach mode can go off (R-100). */
function UnlinkFirst({
  players,
}: {
  readonly players: readonly LinkedPlayer[];
}): JSX.Element {
  const t = useTranslations('settings.coachMode');
  return (
    <div className="flex flex-col gap-2">
      <p>{t('unlinkFirst')}</p>
      <ul className="flex flex-col">
        {players.map((player) => (
          <li key={player.id}>
            <Link href={coachPlayerPath(player.id)} className={TEXT_LINK}>
              {player.displayName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Switching Coach mode off, refused while players are linked (R-100). */
function SwitchOff(): JSX.Element {
  const t = useTranslations();
  const [state, stop] = useActionState(stopCoachingAction, INITIAL);
  return (
    <>
      <p className="text-fg-muted">{t('settings.coachMode.offNote')}</p>
      <StatusLine
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
      {state.players === undefined || state.players.length === 0 ? null : (
        <UnlinkFirst players={state.players} />
      )}
      <form action={stop}>
        <PendingButton className={SECONDARY_BUTTON}>
          {t('settings.coachMode.switchOff')}
        </PendingButton>
      </form>
    </>
  );
}

/**
 * The Coach mode switch in settings (R-11, R-13): anyone may switch it on;
 * switching it off is refused while players are linked (R-100).
 */
export function CoachMode({
  isCoach,
}: {
  readonly isCoach: boolean;
}): JSX.Element {
  const t = useTranslations('settings.coachMode');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <p className="text-fg-muted">{t('intro')}</p>
      <p className="font-medium">{isCoach ? t('on') : t('off')}</p>
      {isCoach ? (
        <SwitchOff />
      ) : (
        <form action={startCoachingAction}>
          <PendingButton className={PRIMARY_BUTTON}>
            {t('switchOn')}
          </PendingButton>
        </form>
      )}
    </section>
  );
}
