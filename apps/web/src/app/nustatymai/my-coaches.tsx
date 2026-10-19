'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { ConfirmedAction } from '../confirmed-action';
import { PendingButton } from '../pending-button';
import { leaveGroupAction, unlinkCoachAction } from './coaching-actions';
import { SECTION, SECTION_TITLE } from './styles';

/** A group of a coach the player is in. */
interface MyCoachGroup {
  readonly id: string;
  readonly name: string;
}

/** A coach the player is linked to, with the player's groups of that coach. */
export interface MyCoach {
  readonly id: string;
  readonly displayName: string;
  readonly groups: readonly MyCoachGroup[];
}

/** The id the section has; accepting an invite lands on it (plan decision 12). */
const SECTION_ID = 'treneriai';

/** One group the player can leave and stay linked (R-45). */
function GroupRow({ group }: { readonly group: MyCoachGroup }): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="min-w-0 break-words">{group.name}</span>
      <form action={leaveGroupAction} className="shrink-0">
        <input type="hidden" name="groupId" value={group.id} />
        <PendingButton
          className={SECONDARY_BUTTON}
          label={t('leaveGroupNamed', { group: group.name })}
        >
          {t('leaveGroup')}
        </PendingButton>
      </form>
    </li>
  );
}

/** One linked coach: the name, the player's groups, and Unlink. */
function CoachRow({ coach }: { readonly coach: MyCoach }): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  const nameId = useId();
  return (
    <li className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 id={nameId} className="text-lg font-semibold">
        {coach.displayName}
      </h3>
      {coach.groups.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">{t('groups')}</p>
          <ul className="flex flex-col gap-2">
            {coach.groups.map((group) => (
              <GroupRow key={group.id} group={group} />
            ))}
          </ul>
        </div>
      )}
      <ConfirmedAction
        action={unlinkCoachAction}
        fields={{ coachId: coach.id }}
        describedBy={nameId}
        label={t('unlink')}
        question={t('unlinkConfirm', { name: coach.displayName })}
        confirm={t('confirmUnlink')}
        cancel={t('cancel')}
      />
    </li>
  );
}

/**
 * "Mano treneriai": the coaches the player is linked to, with unlink and
 * leave group (spec: either side may unlink; R-45).
 */
export function MyCoaches({
  coaches,
}: {
  readonly coaches: readonly MyCoach[];
}): JSX.Element {
  const t = useTranslations('settings.myCoaches');
  const titleId = useId();
  return (
    <section
      id={SECTION_ID}
      aria-labelledby={titleId}
      className={`${SECTION} scroll-mt-4`}
    >
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      {coaches.length === 0 ? (
        <p className="text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {coaches.map((coach) => (
            <CoachRow key={coach.id} coach={coach} />
          ))}
        </ul>
      )}
    </section>
  );
}
