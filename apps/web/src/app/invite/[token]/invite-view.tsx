'use client';

import type { InviteAssignment, InvitePreview } from '@mychess/db';
import type { InviteRefusal, Result } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { PRIMARY_BUTTON, QUIET_ACTION, SECONDARY_BUTTON } from '../../buttons';
import { EntryFrame } from '../../entry-frame';
import { PendingButton } from '../../pending-button';
import { SECTION_TITLE } from '../../settings/styles';
import { StatusLine } from '../../status-line';
import { useShortDeadline } from '../../use-deadline';
import { acceptInviteAction, type AcceptState } from './actions';

/**
 * What accepting would do now: the coach and group, or the refusal. The
 * preview is open to accept, or one this account already accepted and is
 * still linked by (only ever told to that account, #329).
 */
export type InvitePreviewResult = Result<InvitePreview, InviteRefusal>;

type RefusalKey = InviteRefusal['reason'];

type Active = Extract<InvitePreview, { state: 'active' }>;

const INITIAL: AcceptState = {};

const TITLE = 'text-2xl font-bold sm:text-3xl';

/** Where a refused invite sends the player on. */
const WAYS_ON = {
  today: { href: ROUTES.home, label: 'nav.goToday' },
  coach: { href: ROUTES.coach, label: 'invite.backToCoach' },
} as const;

/**
 * Each refusal's heading, line, tone and way on. An invite from a disabled
 * coach (R-108) or one out of Coach mode is already `invalid`, so a
 * refusal says no more than that the invite cannot be used.
 */
const REFUSED = {
  'invite.invalid': {
    title: 'invalidTitle',
    text: 'invalid',
    tone: 'error',
    on: WAYS_ON.today,
  },
  'invite.ownInvite': {
    title: 'ownInviteTitle',
    text: 'ownInvite',
    tone: 'info',
    on: WAYS_ON.coach,
  },
  'invite.coachFull': {
    title: 'title',
    text: 'coachFull',
    tone: 'error',
    on: WAYS_ON.today,
  },
} as const satisfies Record<RefusalKey, unknown>;

/** Why the invite cannot be accepted, and a way on. */
function Refused({ reason }: { readonly reason: RefusalKey }): JSX.Element {
  const t = useTranslations('invite');
  const messages = useTranslations();
  const { title, text, tone, on } = REFUSED[reason];
  return (
    <>
      <h1 className={TITLE}>{t(title)}</h1>
      <StatusLine text={t(text)} tone={tone} />
      <Link href={on.href} className={`${SECONDARY_BUTTON} self-start`}>
        {messages(on.label)}
      </Link>
    </>
  );
}

/** An invite this account already accepted: linked, and on to Today. */
function Accepted({ coach }: { readonly coach: string }): JSX.Element {
  const t = useTranslations();
  return (
    <>
      <h1 className={TITLE}>{t('invite.acceptedTitle', { coach })}</h1>
      <Link href={ROUTES.home} className={`${PRIMARY_BUTTON} self-start`}>
        {t('nav.goToday')}
      </Link>
    </>
  );
}

/** What the coach will see, what stays private, and unlinking (R-39). */
function Privacy(): JSX.Element {
  const t = useTranslations('invite.privacy');
  return (
    <ul className="flex list-disc flex-col gap-2 ps-6">
      <li>{t('sees')}</li>
      <li>{t('private')}</li>
      <li>{t('unlink')}</li>
    </ul>
  );
}

/**
 * The repertoires the group accepting joins has assigned now, each with
 * its deadline in the coach status wording (R-236); nothing for none.
 */
function ComesWith({
  assignments,
  today,
}: {
  readonly assignments: readonly InviteAssignment[];
  readonly today: string;
}): JSX.Element | null {
  const t = useTranslations('invite');
  const status = useTranslations('coach.status');
  const date = useShortDeadline(today);
  const titleId = useId();
  if (assignments.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('comesWith')}
      </h2>
      <ul className="flex flex-col gap-1">
        {assignments.map(({ repertoireName, deadline }, index) => (
          // Two repertoires may share a name: the place keeps keys apart.
          <li key={`${String(index)}:${repertoireName}`}>
            {t('assignment', {
              name: repertoireName,
              deadline:
                deadline === null
                  ? status('noDeadline')
                  : status('deadline', { date: date(deadline) }),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Who invites, to which group, what it means, and Accept or Not now. */
function Confirm({
  token,
  invite,
  today,
  action,
}: {
  readonly token: string;
  readonly invite: Active;
  readonly today: string;
  readonly action: (form: FormData) => void;
}): JSX.Element {
  const t = useTranslations('invite');
  const coach = invite.coachDisplayName;
  return (
    <>
      <h1 className={TITLE}>
        {invite.groupName === null
          ? t('titlePersonal', { coach })
          : t('titleGroup', { coach, group: invite.groupName })}
      </h1>
      <Privacy />
      <ComesWith assignments={invite.assignments} today={today} />
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="token" value={token} />
        <PendingButton className={PRIMARY_BUTTON}>{t('accept')}</PendingButton>
        <Link href={ROUTES.home} className={QUIET_ACTION}>
          {t('notNow')}
        </Link>
      </form>
    </>
  );
}

/** The screen for the preview, or for the refusal Accept met. */
function InviteState({
  token,
  preview,
  today,
}: {
  readonly token: string;
  readonly preview: InvitePreviewResult;
  readonly today: string;
}): JSX.Element {
  const [state, action] = useActionState(acceptInviteAction, INITIAL);
  if (state.refusal !== undefined) return <Refused reason={state.refusal} />;
  if (!preview.ok) return <Refused reason={preview.refusal.reason} />;
  if (preview.value.state === 'accepted')
    return <Accepted coach={preview.value.coachDisplayName} />;
  return (
    <Confirm
      token={token}
      invite={preview.value}
      today={today}
      action={action}
    />
  );
}

/**
 * The invite page (plan decision 8), in the entry frame, one heading per
 * state: nothing is accepted until the player presses Accept, which posts
 * the token alone. `today` is the page's Vilnius day, for the deadlines.
 */
export function InviteView({
  token,
  preview,
  today,
}: {
  readonly token: string;
  readonly preview: InvitePreviewResult;
  readonly today: string;
}): JSX.Element {
  return (
    <EntryFrame>
      <InviteState token={token} preview={preview} today={today} />
    </EntryFrame>
  );
}
