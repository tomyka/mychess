'use client';

import {
  OPEN_INVITE_LIMIT,
  type InviteKind,
  type InviteState,
} from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useId, useState, type JSX } from 'react';
import { DISPLAY_TIME_ZONE } from '../../lib/time-zone';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import { SECTION, SECTION_TITLE } from '../nustatymai/styles';
import { PendingButton } from '../pending-button';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteState,
} from './actions';

/** One of the coach's invites as the list shows it; never its token. */
export interface CoachInviteRow {
  readonly id: string;
  readonly kind: InviteKind;
  readonly groupName: string | null;
  readonly state: InviteState;
  readonly expiresAt: Date;
}

/** A group the coach can name on an invite. */
export interface InviteGroupOption {
  readonly id: string;
  readonly name: string;
}

const INITIAL: CreateInviteState = {};

const FIELD =
  'min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg';

const CHOICE =
  'flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong bg-surface px-3 has-checked:border-accent has-checked:bg-sunken';

/** The link just made, shown once with a Copy button (plan decision 5). */
function FreshLink({ link }: { readonly link: string }): JSX.Element {
  const t = useTranslations('coach.invites');
  const fieldId = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-medium">
        {t('link')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={fieldId}
          type="text"
          readOnly
          value={link}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className={`${FIELD} grow`}
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
            });
          }}
          className={SECONDARY_BUTTON}
        >
          {t('copy')}
        </button>
      </div>
      <p className="text-fg-muted">{t('linkOnce')}</p>
      <StatusLine text={copied ? t('copied') : null} tone="success" />
    </div>
  );
}

/** Personal or group (R-98). */
function KindField(): JSX.Element {
  const t = useTranslations('coach.invites');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">{t('kind')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={CHOICE}>
          <input type="radio" name="kind" value="personal" defaultChecked />
          {t('personal')}
        </label>
        <label className={CHOICE}>
          <input type="radio" name="kind" value="group" />
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

/** When an active invite stops being valid, and its Revoke button. */
function ActiveInvite({
  invite,
}: {
  readonly invite: CoachInviteRow;
}): JSX.Element {
  const t = useTranslations('coach.invites');
  const format = useFormatter();
  const date = format.dateTime(invite.expiresAt, {
    dateStyle: 'medium',
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <>
      <span className="text-fg-muted">{t('expires', { date })}</span>
      <form action={revokeInviteAction}>
        <input type="hidden" name="inviteId" value={invite.id} />
        <PendingButton className={SECONDARY_BUTTON}>
          {t('revoke')}
        </PendingButton>
      </form>
    </>
  );
}

/** One invite: kind, group, state; an active one also expiry and Revoke. */
function InviteRow({
  invite,
}: {
  readonly invite: CoachInviteRow;
}): JSX.Element {
  const t = useTranslations('coach.invites');
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <span className="font-medium">{t(invite.kind)}</span>
      {invite.groupName === null ? null : (
        <span>{t('groupName', { group: invite.groupName })}</span>
      )}
      <span>{t(`state.${invite.state}`)}</span>
      {invite.state === 'active' ? <ActiveInvite invite={invite} /> : null}
    </li>
  );
}

/** Making invites, and the coach's invites with their state (R-98, R-99). */
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
      {invites.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invites.map((invite) => (
            <InviteRow key={invite.id} invite={invite} />
          ))}
        </ul>
      )}
    </section>
  );
}
