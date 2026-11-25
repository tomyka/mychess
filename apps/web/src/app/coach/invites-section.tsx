'use client';

import { OPEN_INVITE_LIMIT, type InviteKind } from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import { MEDIUM_DATE } from '../../lib/date-format';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { SECTION, SECTION_TITLE } from '../settings/styles';
import { PendingButton } from '../pending-button';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { FreshLink } from './fresh-link';
import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteState,
  type RevokeInviteState,
} from './actions';

/**
 * One of the coach's open invites as the list shows it; never its token.
 * The loader lists no used, expired or revoked one (coachInvites, #329).
 */
export interface CoachInviteRow {
  readonly id: string;
  readonly kind: InviteKind;
  readonly groupName: string | null;
  readonly expiresAt: Date;
}

/** A group the coach can name on an invite. */
export interface InviteGroupOption {
  readonly id: string;
  readonly name: string;
}

const INITIAL: CreateInviteState = {};

const NOT_REVOKED: RevokeInviteState = {};

/** A form's dispatch, as useActionState hands it over. */
type Dispatch = (form: FormData) => void;

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken has-checked:ring-1 has-checked:ring-accent';

/** Personal or group (R-98). */
function KindField(): JSX.Element {
  const t = useTranslations('coach.invites');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('kind')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={CHOICE}>
          <input
            type="radio"
            name="kind"
            value="personal"
            defaultChecked
            className="size-5 accent-accent"
          />
          {t('personal')}
        </label>
        <label className={CHOICE}>
          <input
            type="radio"
            name="kind"
            value="group"
            className="size-5 accent-accent"
          />
          {t('group')}
        </label>
      </div>
    </fieldset>
  );
}

/** The group: optional for a personal invite, needed for a group one (R-110). */
function GroupField({
  groups,
}: {
  readonly groups: readonly InviteGroupOption[];
}): JSX.Element {
  const t = useTranslations('coach.invites');
  const fieldId = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-medium">
        {t('groupLabel')}
      </label>
      <select id={fieldId} name="groupId" defaultValue="" className={FIELD}>
        <option value="">{t('noGroup')}</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The form that makes an invite, and the link it made. */
function InviteForm({
  groups,
}: {
  readonly groups: readonly InviteGroupOption[];
}): JSX.Element {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createInviteAction, INITIAL);
  return (
    <div className="flex flex-col gap-4">
      <StatusLine
        text={
          state.refusal === undefined
            ? null
            : t(state.refusal, { limit: OPEN_INVITE_LIMIT })
        }
        tone="error"
      />
      <form
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-4"
      >
        <KindField />
        <GroupField groups={groups} />
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('coach.invites.create')}
        </button>
      </form>
      {state.link === undefined ? null : (
        <FreshLink key={state.link} link={state.link} />
      )}
    </div>
  );
}

/** When an active invite stops being valid. */
function Expiry({ invite }: { readonly invite: CoachInviteRow }): JSX.Element {
  const t = useTranslations('coach.invites');
  const format = useFormatter();
  const date = format.dateTime(invite.expiresAt, MEDIUM_DATE);
  return <span>{t('expires', { date })}</span>;
}

/** An active invite's Revoke button. */
function RevokeForm({
  invite,
  revoke,
}: {
  readonly invite: CoachInviteRow;
  readonly revoke: Dispatch;
}): JSX.Element {
  const t = useTranslations('coach.invites');
  return (
    <form action={revoke} className="shrink-0">
      <input type="hidden" name="inviteId" value={invite.id} />
      <PendingButton className={SECONDARY_BUTTON}>{t('revoke')}</PendingButton>
    </form>
  );
}

/**
 * One open invite: kind and group on the first line, when it expires on
 * the second; its Revoke at the row's end.
 */
function InviteRow({
  invite,
  revoke,
}: {
  readonly invite: CoachInviteRow;
  readonly revoke: Dispatch;
}): JSX.Element {
  const t = useTranslations('coach.invites');
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap gap-x-3">
          <span className="font-medium">{t(invite.kind)}</span>
          {invite.groupName === null ? null : (
            <span className="break-words">
              {t('groupName', { group: invite.groupName })}
            </span>
          )}
        </p>
        <p className="text-fg-muted">
          <Expiry invite={invite} />
        </p>
      </div>
      <RevokeForm invite={invite} revoke={revoke} />
    </li>
  );
}

/**
 * The coach's open invites, and a refused Revoke. revokeInvite
 * refuses only as "not valid": the invite was used, expired or revoked
 * since the list was shown, which is what the line says to the coach.
 */
function InviteList({
  invites,
}: {
  readonly invites: readonly CoachInviteRow[];
}): JSX.Element {
  const t = useTranslations('coach.invites');
  const [state, revoke] = useActionState(revokeInviteAction, NOT_REVOKED);
  return (
    <>
      <StatusLine
        text={state.refusal === undefined ? null : t('revokeInvalid')}
        tone="error"
      />
      {invites.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invites.map((invite) => (
            <InviteRow key={invite.id} invite={invite} revoke={revoke} />
          ))}
        </ul>
      )}
    </>
  );
}

/** Making invites, and the coach's open invites (R-98, R-99). */
export function InvitesSection({
  groups,
  invites,
}: {
  readonly groups: readonly InviteGroupOption[];
  readonly invites: readonly CoachInviteRow[];
}): JSX.Element {
  const t = useTranslations('coach.invites');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <p className="text-fg-muted">{t('intro')}</p>
      <InviteForm groups={groups} />
      <InviteList invites={invites} />
    </section>
  );
}
