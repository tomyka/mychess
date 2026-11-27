'use client';

import type { OpenGroupInvite } from '@mychess/db';
import { useTranslations } from 'next-intl';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
} from 'react';
import { SECONDARY_BUTTON } from '../../../buttons';
import { ConfirmedAction } from '../../../confirmed-action';
import { PendingButton } from '../../../pending-button';
import { SECTION_TITLE } from '../../../settings/styles';
import { StatusLine } from '../../../status-line';
import { useShortInstant } from '../../../use-deadline';
import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteState,
  type RevokeInviteState,
} from '../../actions';
import { FreshLink } from '../../fresh-link';
import { InviteRefusalLine } from '../../refusal-line';

const NOT_CREATED: CreateInviteState = {};

const NOT_REVOKED: RevokeInviteState = {};

/**
 * The link just made, shown once with Copy and scrolled into view: block
 * `nearest` with the page's scroll-padding keeps it clear of the phone's
 * tab bar.
 */
function NewLink({ link }: { readonly link: string }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={boxRef}>
      <FreshLink link={link} />
    </div>
  );
}

/**
 * Revoke the open link (R-233), in the error tone and confirmed; a refusal
 * means it was used up, expired or revoked since the page was shown.
 * `onRevoked` hides a link just made, which no longer works.
 */
function RevokeLink({
  invite,
  onRevoked,
}: {
  readonly invite: OpenGroupInvite;
  readonly onRevoked: () => void;
}): JSX.Element {
  const t = useTranslations('coach');
  const [state, revoke] = useActionState(
    async (previous: RevokeInviteState, form: FormData) => {
      const next = await revokeInviteAction(previous, form);
      if (next.refusal === undefined) onRevoked();
      return next;
    },
    NOT_REVOKED,
  );
  return (
    <div className="flex flex-col gap-2">
      <ConfirmedAction
        action={revoke}
        fields={{ inviteId: invite.id }}
        label={t('invites.revoke')}
        question={t('group.revokeConfirm')}
        confirm={t('inviteSheet.confirmRevoke')}
        cancel={t('group.cancel')}
        look="danger"
      />
      <StatusLine
        text={state.refusal === undefined ? null : t('invites.revokeInvalid')}
        tone="error"
      />
    </div>
  );
}

/**
 * New link: a group invite (R-98), which replaces the group's open one
 * (R-233); the link shows once, inline, or the refusal (R-114).
 */
function useNewLink(): {
  readonly state: CreateInviteState;
  readonly action: (form: FormData) => void;
  readonly shown: string | null;
  readonly hide: () => void;
} {
  const [shown, setShown] = useState<string | null>(null);
  const [state, action] = useActionState(
    async (previous: CreateInviteState, form: FormData) => {
      const next = await createInviteAction(previous, form);
      setShown(next.link ?? null);
      return next;
    },
    NOT_CREATED,
  );
  return {
    state,
    action,
    shown,
    hide: () => {
      setShown(null);
    },
  };
}

/**
 * The group's invite link (R-232, R-233): when its one open link expires,
 * or that there is none; links are shown once, when made (R-98), so New
 * link makes another, which replaces the open one. Revoke closes it.
 */
export function GroupInviteLink({
  groupId,
  invite,
  today,
  className,
}: {
  readonly groupId: string;
  readonly invite: OpenGroupInvite | null;
  /** Today's Vilnius day from the loader. */
  readonly today: string;
  readonly className?: string;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const date = useShortInstant(today);
  const titleId = useId();
  const made = useNewLink();
  return (
    <section aria-labelledby={titleId} className={className}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('inviteTitle')}
      </h2>
      <p>
        {invite === null
          ? t('noOpenLink')
          : t('openLink', { date: date(invite.expiresAt) })}
      </p>
      <p className="text-sm text-fg-muted">{t('linkHint')}</p>
      <InviteRefusalLine refusal={made.state.refusal} />
      <div className="flex flex-wrap items-start gap-3">
        <form action={made.action} className="flex flex-col">
          <input type="hidden" name="kind" value="group" />
          <input type="hidden" name="groupId" value={groupId} />
          <PendingButton className={SECONDARY_BUTTON}>
            {t('newLink')}
          </PendingButton>
        </form>
        {invite === null ? null : (
          <RevokeLink key={invite.id} invite={invite} onRevoked={made.hide} />
        )}
      </div>
      {made.shown === null ? null : (
        <NewLink key={made.shown} link={made.shown} />
      )}
    </section>
  );
}
