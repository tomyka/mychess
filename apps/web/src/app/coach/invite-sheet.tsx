'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useRef, useState, type JSX } from 'react';
import type { PersonalInvite } from '../../server/coach-pages';
import { PRIMARY_BUTTON, QUIET_ACTION, SECONDARY_BUTTON } from '../buttons';
import { ConfirmedAction } from '../confirmed-action';
import { PendingButton } from '../pending-button';
import { Sheet } from '../sheet';
import { StatusLine } from '../status-line';
import { useShortInstant } from '../use-deadline';
import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteState,
  type RevokeInviteState,
} from './actions';
import { FreshLink } from './fresh-link';
import { InviteRefusalLine } from './refusal-line';

const NOT_CREATED: CreateInviteState = {};

const NOT_REVOKED: RevokeInviteState = {};

/** The link just made, with who it is for and until when (R-98, R-99). */
function NewLink({
  link,
  expiresAt,
  today,
}: {
  readonly link: string;
  readonly expiresAt: Date;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach.inviteSheet');
  const date = useShortInstant(today);
  return (
    <FreshLink
      link={link}
      note={t('linkOnceUntil', { date: date(expiresAt) })}
    />
  );
}

/**
 * Create link: a personal invite (R-98), its link shown once below the
 * button, or the refusal (R-114, Coach mode off) in the status line. Once
 * a link is shown, Create link turns secondary: copying it is the next
 * step, not making another.
 */
function CreateLink({ today }: { readonly today: string }): JSX.Element {
  const t = useTranslations('coach.inviteSheet');
  const [state, action] = useActionState(createInviteAction, NOT_CREATED);
  const shown =
    state.link === undefined || state.expiresAt === undefined
      ? null
      : { link: state.link, expiresAt: state.expiresAt };
  return (
    <div className="flex flex-col gap-4">
      <p>{t('intro')}</p>
      <InviteRefusalLine refusal={state.refusal} />
      <form action={action} className="flex flex-col">
        <input type="hidden" name="kind" value="personal" />
        <PendingButton
          className={shown === null ? PRIMARY_BUTTON : SECONDARY_BUTTON}
        >
          {t('create')}
        </PendingButton>
      </form>
      {shown === null ? null : (
        <NewLink
          key={shown.link}
          link={shown.link}
          expiresAt={shown.expiresAt}
          today={today}
        />
      )}
    </div>
  );
}

/** One open personal invite: its dates, never its link, and Revoke. */
function InviteRow({
  invite,
  revoke,
  today,
}: {
  readonly invite: PersonalInvite;
  readonly revoke: (form: FormData) => void;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const date = useShortInstant(today);
  const datesId = useId();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p id={datesId} className="text-fg-muted">
        {t('inviteSheet.dates', {
          made: date(invite.createdAt),
          expires: date(invite.expiresAt),
        })}
      </p>
      <ConfirmedAction
        action={revoke}
        fields={{ inviteId: invite.id }}
        label={t('invites.revoke')}
        question={t('inviteSheet.revokeConfirm')}
        confirm={t('inviteSheet.confirmRevoke')}
        cancel={t('inviteSheet.cancel')}
        describedBy={datesId}
        look="danger"
      />
    </li>
  );
}

/**
 * The coach's open personal invites (R-232); the group's are on its page.
 * A refused Revoke means the invite was used, expired or revoked since the
 * list was shown.
 */
function OpenInvites({
  invites,
  today,
}: {
  readonly invites: readonly PersonalInvite[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  const [state, revoke] = useActionState(revokeInviteAction, NOT_REVOKED);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="font-semibold">
        {t('inviteSheet.openTitle')}
      </h3>
      <StatusLine
        text={state.refusal === undefined ? null : t('invites.revokeInvalid')}
        tone="error"
      />
      {invites.length === 0 ? (
        <p className="text-fg-muted">{t('invites.empty')}</p>
      ) : (
        <ul aria-labelledby={titleId} className="flex flex-col gap-3">
          {invites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              revoke={revoke}
              today={today}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Invite a player (R-232): the button, and the sheet it opens, where the
 * coach makes a personal invite link and sees the open ones.
 */
export function InviteSheet({
  invites,
  today,
}: {
  readonly invites: readonly PersonalInvite[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach.inviteSheet');
  const [open, setOpen] = useState(false);
  const titleId = useId();
  // Focus goes back here on closing: Safari does not focus a clicked button.
  const opener = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpen(false);
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
        className={`${SECONDARY_BUTTON} shrink-0`}
      >
        {t('title')}
      </button>
      <Sheet
        open={open}
        onClose={close}
        titleId={titleId}
        returnFocusRef={opener}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-xl font-bold">
              {t('title')}
            </h2>
            <button type="button" onClick={close} className={QUIET_ACTION}>
              {t('close')}
            </button>
          </div>
          <CreateLink today={today} />
          <OpenInvites invites={invites} today={today} />
        </div>
      </Sheet>
    </>
  );
}
