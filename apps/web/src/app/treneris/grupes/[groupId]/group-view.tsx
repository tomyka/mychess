'use client';

import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import type { GroupGrid } from '../../../../server/coach-progress';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../../buttons';
import { ConfirmedAction } from '../../../confirmed-action';
import { SECTION, SECTION_TITLE } from '../../../nustatymai/styles';
import { PendingButton } from '../../../pending-button';
import {
  addMemberAction,
  deleteGroupAction,
  removeMemberAction,
  type CoachActionState,
} from '../../actions';
import { RefusalLine } from '../../refusal-line';
import { COACH_PAGE, SubpageHeader } from '../../subpage-header';
import { ProgressGrid } from './progress-grid';
import { RenameGroupForm } from './rename-group-form';

/** One of the coach's groups, its members, and the linked players to add. */
export interface CoachGroupPageData {
  readonly id: string;
  readonly name: string;
  readonly members: readonly AccountRef[];
  /** The coach's linked players not yet in the group. */
  readonly addable: readonly AccountRef[];
}

const INITIAL: CoachActionState = {};

/** A form's dispatch, as useActionState hands it over. */
type Dispatch = (form: FormData) => void;

/** One member, with Remove (the link stays). */
function MemberRow({
  groupId,
  member,
  remove,
}: {
  readonly groupId: string;
  readonly member: AccountRef;
  readonly remove: Dispatch;
}): JSX.Element {
  const t = useTranslations('coach.group');
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="min-w-0 break-words">{member.displayName}</span>
      <form action={remove} className="shrink-0">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="playerId" value={member.id} />
        <PendingButton
          className={SECONDARY_BUTTON}
          label={t('removeNamed', { name: member.displayName })}
        >
          {t('remove')}
        </PendingButton>
      </form>
    </li>
  );
}

/** The group's members, each with Remove, and a refused Remove. */
function Members({
  group,
}: {
  readonly group: CoachGroupPageData;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const titleId = useId();
  const [state, remove] = useActionState(removeMemberAction, INITIAL);
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('membersTitle')}
      </h2>
      <RefusalLine state={state} />
      {group.members.length === 0 ? (
        <p className="text-fg-muted">{t('noMembers')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {group.members.map((member) => (
            <MemberRow
              key={member.id}
              groupId={group.id}
              member={member}
              remove={remove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The picker of linked players not yet in the group (R-12). */
function AddPicker({
  group,
  add,
}: {
  readonly group: CoachGroupPageData;
  readonly add: Dispatch;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const fieldId = useId();
  return (
    <form action={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="groupId" value={group.id} />
      <div className="flex grow flex-col gap-2">
        <label htmlFor={fieldId} className="font-medium">
          {t('addLabel')}
        </label>
        <select
          id={fieldId}
          name="playerId"
          className="min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg"
        >
          {group.addable.map((player) => (
            <option key={player.id} value={player.id}>
              {player.displayName}
            </option>
          ))}
        </select>
      </div>
      <PendingButton className={PRIMARY_BUTTON}>{t('add')}</PendingButton>
    </form>
  );
}

/** Why there is no one to add: everyone linked is in, or nobody is linked. */
function NobodyToAdd({
  group,
}: {
  readonly group: CoachGroupPageData;
}): JSX.Element {
  const t = useTranslations('coach');
  return (
    <p className="text-fg-muted">
      {group.members.length === 0 ? t('players.empty') : t('group.allIn')}
    </p>
  );
}

/** "Add a player": the picker, or why there is no one to add; a refused Add. */
function AddMember({
  group,
}: {
  readonly group: CoachGroupPageData;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const titleId = useId();
  const [state, add] = useActionState(addMemberAction, INITIAL);
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('addTitle')}
      </h2>
      <RefusalLine state={state} />
      {group.addable.length === 0 ? (
        <NobodyToAdd group={group} />
      ) : (
        <AddPicker group={group} add={add} />
      )}
    </section>
  );
}

/**
 * One group's page in the coach dashboard (plan decision 11), with the
 * group's progress grid above the members (R-153).
 */
export function GroupView({
  group,
  grid,
}: {
  readonly group: CoachGroupPageData;
  readonly grid: GroupGrid;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const nameId = useId();
  return (
    <main className={COACH_PAGE}>
      <div className="flex flex-col gap-4">
        <SubpageHeader title={group.name} titleId={nameId} />
        <RenameGroupForm groupId={group.id} name={group.name} />
      </div>
      <ProgressGrid grid={grid} />
      <Members group={group} />
      <AddMember group={group} />
      <ConfirmedAction
        action={deleteGroupAction}
        fields={{ groupId: group.id }}
        describedBy={nameId}
        label={t('delete')}
        question={t('deleteConfirm', { name: group.name })}
        confirm={t('confirmDelete')}
        cancel={t('cancel')}
      />
    </main>
  );
}
