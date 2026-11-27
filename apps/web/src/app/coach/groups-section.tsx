'use client';

import type { CoachGroupSummary } from '@mychess/db';
import { OPEN_INVITE_LIMIT } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { coachGroupPath } from '../../lib/routes';
import { PRIMARY_BUTTON, QUIET_ACTION } from '../buttons';
import { FIELD } from '../fields';
import { SECTION_TITLE, TEXT_LINK } from '../settings/styles';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { CARD } from '../surfaces';
import { createGroupAction, type CreateGroupState } from './actions';
import { FreshLink } from './fresh-link';
import { GroupMeta } from './group-meta';
import { ROW_LINK } from './row-link';

/** One of the coach's groups as the dashboard shows it. */
export type DashboardGroup = Pick<
  CoachGroupSummary,
  'id' | 'name' | 'memberCount' | 'assignments'
>;

const INITIAL: CreateGroupState = {};

/**
 * The "new group" form (R-12, R-70), with Cancel to close it. Opened by a
 * press, it takes focus; it and then each new link scroll into view, clear
 * of the phone's tab bar (scroll-padding in globals.css).
 */
function CreateGroupForm({
  onCancel,
}: {
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations();
  const fieldId = useId();
  const statusId = useId();
  const [state, action, pending] = useActionState(createGroupAction, INITIAL);
  const refused = state.refusal !== undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'nearest' });
  }, [state.link]);
  return (
    <div ref={boxRef} className={`${CARD} flex flex-col gap-3 p-4`}>
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
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="font-medium">
            {t('coach.groups.name')}
          </label>
          <input
            ref={fieldRef}
            id={fieldId}
            type="text"
            name="name"
            autoComplete="off"
            aria-invalid={refused ? true : undefined}
            aria-describedby={refused ? statusId : undefined}
            className={FIELD}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t('coach.groups.create')}
          </button>
          <button type="button" onClick={onCancel} className={QUIET_ACTION}>
            {t('coach.groups.cancel')}
          </button>
        </div>
      </form>
      <NewGroupInvite state={state} />
    </div>
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

/** One group card: its name (to its page) and its meta line. */
function GroupCard({
  group,
  today,
}: {
  readonly group: DashboardGroup;
  readonly today: string;
}): JSX.Element {
  return (
    <li className={`${CARD} relative flex flex-col gap-1 p-4`}>
      <Link href={coachGroupPath(group.id)} className={ROW_LINK}>
        {group.name}
      </Link>
      <GroupMeta
        memberCount={group.memberCount}
        assignments={group.assignments}
        today={today}
      />
    </li>
  );
}

/**
 * Whether the create form is open. The form takes focus as it opens;
 * Cancel moves it back to New group (never on the first render).
 */
function useCreateForm(): {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
} {
  const [open, setOpen] = useState(false);
  const cancelled = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!cancelled.current) return;
    cancelled.current = false;
    buttonRef.current?.focus();
  }, [open]);
  return {
    open,
    toggle: () => {
      setOpen(!open);
    },
    close: () => {
      cancelled.current = true;
      setOpen(false);
    },
    buttonRef,
  };
}

/**
 * The coach's groups, each a card to its page (spec, The dashboard), and
 * New group, which opens the create form in place.
 */
export function GroupsSection({
  groups,
  today,
}: {
  readonly groups: readonly DashboardGroup[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  const formId = useId();
  const form = useCreateForm();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 id={titleId} className={SECTION_TITLE}>
          {t('sectionCount', {
            title: t('groups.title'),
            count: groups.length,
          })}
        </h2>
        <button
          ref={form.buttonRef}
          type="button"
          aria-expanded={form.open}
          aria-controls={formId}
          onClick={form.toggle}
          className={`${TEXT_LINK} -my-2.5 font-semibold`}
        >
          {t('groups.new')}
        </button>
      </div>
      <div id={formId} hidden={!form.open}>
        {form.open ? <CreateGroupForm onCancel={form.close} /> : null}
      </div>
      {groups.length === 0 ? null : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}
