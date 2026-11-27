'use client';

import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import type { CoachGroupPage } from '../../../../server/coach-pages';
import { ConfirmedAction } from '../../../confirmed-action';
import { SECTION_TITLE } from '../../../settings/styles';
import { CONTENT } from '../../../surfaces';
import {
  deleteGroupAction,
  removeMemberAction,
  type CoachActionState,
} from '../../actions';
import { RefusalLine } from '../../refusal-line';
import { AddMember } from './add-member';
import { AssignedSection } from './assigned-section';
import { GroupHeader } from './group-header';
import { GroupInviteLink } from './group-invite-link';
import { ProgressGrid } from './progress-grid';

/** What the group page shows: the loader's read, its members by id and name. */
export type GroupPageData = Pick<
  CoachGroupPage,
  'id' | 'name' | 'addable' | 'grid' | 'invite' | 'assignments' | 'today'
> & { readonly members: readonly AccountRef[] };

const NOT_REMOVED: CoachActionState = {};

/**
 * A section after Progress: a rule above it (design, group page height
 * budget), none at the top of the side column from lg.
 */
const SIDE_SECTION =
  'flex flex-col gap-3 border-t border-border pt-6 lg:first:border-t-0 lg:first:pt-0';

/** One member, with Remove (the link stays). */
function MemberRow({
  groupId,
  member,
  remove,
}: {
  readonly groupId: string;
  readonly member: AccountRef;
  readonly remove: (form: FormData) => void;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const nameId = useId();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-2 first:border-t-0">
      <span id={nameId} className="min-w-0 break-words">
        {member.displayName}
      </span>
      {/* Asks first, as Unlink does (#329). */}
      <ConfirmedAction
        action={remove}
        fields={{ groupId, playerId: member.id }}
        describedBy={nameId}
        label={t('remove')}
        question={t('removeConfirm', { name: member.displayName })}
        confirm={t('confirmRemove')}
        cancel={t('cancel')}
        look="danger"
      />
    </li>
  );
}

/** Players · N: the members, each with Remove, and Add a player. */
function Players({ page }: { readonly page: GroupPageData }): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  const [state, remove] = useActionState(removeMemberAction, NOT_REMOVED);
  return (
    <section aria-labelledby={titleId} className={SIDE_SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('sectionCount', {
          title: t('players.title'),
          count: page.members.length,
        })}
      </h2>
      <RefusalLine state={state} />
      {page.members.length === 0 ? (
        <p className="text-fg-muted">{t('group.noMembers')}</p>
      ) : (
        <ul className="flex flex-col">
          {page.members.map((member) => (
            <MemberRow
              key={member.id}
              groupId={page.id}
              member={member}
              remove={remove}
            />
          ))}
        </ul>
      )}
      <AddMember page={page} />
    </section>
  );
}

/** Delete group, in the error tone, confirmed. */
function DeleteGroup({ page }: { readonly page: GroupPageData }): JSX.Element {
  const t = useTranslations('coach.group');
  return (
    <ConfirmedAction
      action={deleteGroupAction}
      fields={{ groupId: page.id }}
      label={t('delete')}
      question={t('deleteConfirm', { name: page.name })}
      confirm={t('confirmDelete')}
      cancel={t('cancel')}
      look="danger"
    />
  );
}

/**
 * One of the coach's groups (spec, A group): its progress first, then
 * what is assigned to it, its invite link and its players; from lg the
 * progress on the left and the rest in a side column. Delete group is
 * rendered once, last: at the bottom on a phone, and placed by the page's
 * grid at the right of the header from md.
 */
export function GroupView({
  page,
}: {
  readonly page: GroupPageData;
}): JSX.Element {
  return (
    <main
      className={`${CONTENT} gap-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start`}
    >
      <GroupHeader
        group={{ ...page, memberCount: page.members.length }}
        today={page.today}
        className="md:col-start-1 md:row-start-1"
      />
      <div className="flex flex-col gap-8 md:col-span-2 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <ProgressGrid grid={page.grid} />
        <div className="flex min-w-0 flex-col gap-8">
          <AssignedSection
            columns={page.grid.columns}
            today={page.today}
            className={SIDE_SECTION}
          />
          <GroupInviteLink
            groupId={page.id}
            invite={page.invite}
            today={page.today}
            className={SIDE_SECTION}
          />
          <Players page={page} />
        </div>
      </div>
      <div className="mt-2 flex flex-col border-t border-border pt-6 md:col-start-2 md:row-start-1 md:mt-0 md:items-end md:border-t-0 md:pt-0">
        <DeleteGroup page={page} />
      </div>
    </main>
  );
}
