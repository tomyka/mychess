'use client';

import { OPEN_INVITE_LIMIT } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useId, type JSX } from 'react';
import { coachGroupPath } from '../../lib/routes';
import { PRIMARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../settings/styles';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { createGroupAction, type CreateGroupState } from './actions';
import { FreshLink } from './fresh-link';

/** One of the coach's groups as the coach dashboard lists them. */
export interface CoachGroupRow {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

const INITIAL: CreateGroupState = {};

/** The "new group" form (R-12, R-70). */
function CreateGroupForm(): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useActionState(createGroupAction, INITIAL);
  const refused = state.refusal !== undefined;
  return (
    <>
      <StatusLine
        id={statusId}
        text={state.refusal === undefined ? null : t(state.refusal)}
        tone="error"
      />
      {/* Keyed by the last group made, so the field comes back empty. */}
      <form
        key={state.createdId ?? 'new'}
        noValidate
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex grow flex-col gap-2">
          <label htmlFor={fieldId} className="font-medium">
            {t('coach.groups.name')}
          </label>
          <input
            id={fieldId}
            type="text"
            name="name"
            autoComplete="off"
            aria-invalid={refused ? true : undefined}
            aria-describedby={refused ? statusId : undefined}
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t('coach.groups.create')}
        </button>
      </form>
      <NewGroupInvite state={state} />
    </>
  );
}

/**
 * After a group is made: its invite link once (R-204), or why it has none,
 * the coach's open-invite limit (R-114).
 */
function NewGroupInvite({
  state,
}: {
  readonly state: CreateGroupState;
}): JSX.Element | null {
  const t = useTranslations('coach.groups');
  if (state.link !== undefined)
    return <FreshLink key={state.link} link={state.link} />;
  if (state.noLink !== undefined)
    return <p>{t('createdNoLink', { limit: OPEN_INVITE_LIMIT })}</p>;
  return null;
}

/** The coach's groups, each to its page, and the form to make one. */
export function GroupsSection({
  groups,
}: {
  readonly groups: readonly CoachGroupRow[];
}): JSX.Element {
  const t = useTranslations('coach.groups');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      {groups.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex flex-wrap items-center justify-between gap-x-3"
            >
              <Link href={coachGroupPath(group.id)} className={TEXT_LINK}>
                {group.name}
              </Link>
              <span className="text-fg-muted">
                {t('members', { count: group.memberCount })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <CreateGroupForm />
    </section>
  );
}
