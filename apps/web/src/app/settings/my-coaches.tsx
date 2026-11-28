'use client';

import type { GroupRef } from '@mychess/db';
import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import { MY_COACHES_SECTION } from '../../lib/routes';
import type { MyCoach } from '../../server/settings-page';
import { DANGER_ROW_FITTED } from '../buttons';
import { AssignmentStatusLine } from '../coach/assignment-status-line';
import { ConfirmedAction } from '../confirmed-action';
import { PendingButton } from '../pending-button';
import { leaveGroupAction, unlinkCoachAction } from './coaching-actions';
import { SECTION_TITLE, SETTINGS_CARD } from './styles';

/** A row of a coach: its text first, its action at the end from sm. */
const ROW =
  'flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3';

/** One group the player can leave and stay linked (R-45). */
function GroupRow({ group }: { readonly group: GroupRef }): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  return (
    <li className={ROW}>
      <span className="min-w-0 break-words">{group.name}</span>
      <form action={leaveGroupAction} className="sm:shrink-0">
        <input type="hidden" name="groupId" value={group.id} />
        <PendingButton
          className={DANGER_ROW_FITTED}
          label={t('leaveGroupNamed', { group: group.name })}
        >
          {t('leaveGroup')}
        </PendingButton>
      </form>
    </li>
  );
}

/** A labelled block of a coach's row: Assigned or Groups. */
function Block({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (labelId: string) => JSX.Element;
}): JSX.Element {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm text-fg-muted">
        {label}
      </p>
      {children(labelId)}
    </div>
  );
}

/**
 * What the coach assigns the player, each with the shared status line in
 * "deadline" wording (R-237); nothing when the coach assigns none.
 */
function Assigned({
  coach,
  today,
}: {
  readonly coach: MyCoach;
  readonly today: string;
}): JSX.Element | null {
  const t = useTranslations('settings.myCoaches');
  if (coach.assignments.length === 0) return null;
  return (
    <Block label={t('assigned')}>
      {(labelId) => (
        <ul aria-labelledby={labelId} className="flex flex-col gap-2">
          {coach.assignments.map(({ repertoireId, name, status }) => (
            <li key={repertoireId} className="flex flex-col gap-1">
              <span className="font-medium break-words">{name}</span>
              <AssignmentStatusLine
                status={status}
                today={today}
                wording="deadline"
              />
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/** The player's groups of the coach, each with Leave group. */
function Groups({ coach }: { readonly coach: MyCoach }): JSX.Element | null {
  const t = useTranslations('settings.myCoaches');
  if (coach.groups.length === 0) return null;
  return (
    <Block label={t('groups')}>
      {(labelId) => (
        <ul aria-labelledby={labelId} className="flex flex-col gap-2">
          {coach.groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      )}
    </Block>
  );
}

/** One linked coach: the name and Unlink, what it assigns, and the groups. */
function CoachRow({
  coach,
  today,
}: {
  readonly coach: MyCoach;
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  const nameId = useId();
  return (
    <li className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className={ROW}>
        <h3 id={nameId} className="text-lg font-semibold break-words">
          {coach.displayName}
        </h3>
        <ConfirmedAction
          action={unlinkCoachAction}
          fields={{ coachId: coach.id }}
          describedBy={nameId}
          label={t('unlink')}
          question={t('unlinkConfirm', { name: coach.displayName })}
          confirm={t('confirmUnlink')}
          cancel={t('cancel')}
          look="dangerRow"
        />
      </div>
      <Assigned coach={coach} today={today} />
      <Groups coach={coach} />
    </li>
  );
}

/**
 * "My coaches" (R-237): every coach the player is linked to, with what each
 * assigns and the player's groups of it, Unlink and Leave group (spec:
 * either side may unlink; R-45); with none, how a coach links. `today` is
 * the page's Vilnius day, for the deadlines. When ROUTES.myCoaches opens
 * it, its scroll margin clears the top bar, which is sticky only from md.
 */
export function MyCoaches({
  coaches,
  today,
}: {
  readonly coaches: readonly MyCoach[];
  readonly today: string;
}): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  const titleId = useId();
  return (
    <section
      id={MY_COACHES_SECTION}
      aria-labelledby={titleId}
      className={`${SETTINGS_CARD} scroll-mt-4 md:scroll-mt-[calc(var(--spacing-tabbar)+1rem)]`}
    >
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      {coaches.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {coaches.map((coach) => (
            <CoachRow key={coach.id} coach={coach} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}
