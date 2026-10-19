'use client';

import type { InviteKind, InviteRefusal, Result } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, type JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { TEXT_LINK } from '../../nustatymai/styles';
import { PendingButton } from '../../pending-button';
import { acceptInviteAction, type AcceptState } from './actions';

/** Who invites and to which group, as the confirm screen names them. */
interface InvitePreview {
  readonly coachDisplayName: string;
  readonly groupName: string | null;
  readonly kind: InviteKind;
}

/** What accepting would do now: the coach and group, or the refusal. */
export type InvitePreviewResult = Result<InvitePreview, InviteRefusal>;

type RefusalKey = InviteRefusal['reason'];

/**
 * The text of each refusal. An invite from a disabled coach (R-108) or one
 * out of Coach mode is already `invalid`, so a refusal says no more than
 * that the invite cannot be used.
 */
const REFUSAL_TEXT = {
  'invite.invalid': 'invalid',
  'invite.ownInvite': 'ownInvite',
  'invite.coachFull': 'coachFull',
} as const satisfies Record<RefusalKey, string>;

const INITIAL: AcceptState = {};

const PAGE =
  'mx-auto flex w-full max-w-2xl flex-col gap-6 px-gutter py-8 sm:px-gutter-wide';

function Title(): JSX.Element {
  const t = useTranslations('invite');
  return <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>;
}

/** Why the invite cannot be accepted, and a way home. */
function Refused({ reason }: { readonly reason: RefusalKey }): JSX.Element {
  const t = useTranslations('invite');
  return (
    <main className={PAGE}>
      <Title />
      <p>{t(REFUSAL_TEXT[reason])}</p>
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
    </main>
  );
}

/** Who invites, to which group, and Accept or Not now. */
function Confirm({
  token,
  invite,
  action,
}: {
  readonly token: string;
  readonly invite: InvitePreview;
  readonly action: (form: FormData) => void;
}): JSX.Element {
  const t = useTranslations('invite');
  return (
    <main className={PAGE}>
      <Title />
      <div className="flex flex-col gap-1 text-lg">
        <p className="font-semibold">
          {t('fromCoach', { coach: invite.coachDisplayName })}
        </p>
        {invite.groupName === null ? null : (
          <p>{t('toGroup', { group: invite.groupName })}</p>
        )}
      </div>
      <p className="text-fg-muted">{t('explain')}</p>
      <form action={action} className="flex flex-wrap gap-3">
        <input type="hidden" name="token" value={token} />
        <PendingButton className={PRIMARY_BUTTON}>{t('accept')}</PendingButton>
        <Link href={ROUTES.home} className={SECONDARY_BUTTON}>
          {t('notNow')}
        </Link>
      </form>
    </main>
  );
}

/**
 * The invite page's confirm screen (plan decision 8): nothing is accepted
 * until the player presses Accept, which posts the token alone.
 */
export function InviteView({
  token,
  preview,
}: {
  readonly token: string;
  readonly preview: InvitePreviewResult;
}): JSX.Element {
  const [state, action] = useActionState(acceptInviteAction, INITIAL);
  if (state.refusal !== undefined) return <Refused reason={state.refusal} />;
  if (!preview.ok) return <Refused reason={preview.refusal.reason} />;
  return <Confirm token={token} invite={preview.value} action={action} />;
}
