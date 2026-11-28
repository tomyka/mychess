'use client';

import type { GroupAssignment } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { ROUTES } from '../../../../lib/routes';
import { BACK_BUTTON } from '../../../buttons';
import { BACK_ICON, Icon } from '../../../line-icon';
import { TEXT_LINK } from '../../../settings/styles';
import { HeaderAccountMenu } from '../../../shell/account-menu';
import { renameGroupAction, type RenameGroupState } from '../../actions';
import { GroupMeta } from '../../group-meta';
import { RenameGroupForm } from './rename-group-form';

const NOT_RENAMED: RenameGroupState = {};

/** The inline rename: whether it is open, its action's state, and Rename's focus. */
interface Renaming {
  readonly editing: boolean;
  /** The action's state since the form last opened ({} before a submit). */
  readonly state: RenameGroupState;
  /** Saved since the form last opened, and closed. */
  readonly saved: boolean;
  readonly action: (form: FormData) => void;
  readonly pending: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The rename form's state, held here so a save closes the form. Focus
 * goes back to Rename once it closes (never on the first render); a state
 * from an earlier opening is not shown again.
 */
function useRenaming(): Renaming {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: RenameGroupState, form: FormData) => {
      const next = await renameGroupAction(previous, form);
      if (next.saved === true) setEditing(false);
      return next;
    },
    NOT_RENAMED,
  );
  const before = useRef<RenameGroupState>(state);
  const wasEditing = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing === wasEditing.current) return;
    wasEditing.current = editing;
    if (!editing) buttonRef.current?.focus();
  }, [editing]);
  const fresh = state === before.current ? NOT_RENAMED : state;
  return {
    editing,
    state: fresh,
    saved: fresh.saved === true,
    action,
    pending,
    open: () => {
      before.current = state;
      setEditing(true);
    },
    close: () => {
      setEditing(false);
    },
    buttonRef,
  };
}

/** The way back to the coach dashboard. */
function BackLink(): JSX.Element {
  const t = useTranslations('nav');
  return (
    <Link
      href={ROUTES.coach}
      aria-label={t('back', { parent: t('coach') })}
      className={`${BACK_BUTTON} order-1`}
    >
      <Icon path={BACK_ICON} className="size-6" />
    </Link>
  );
}

/** The group's name as the page title, or the rename form in its place. */
function NameOrForm({
  group,
  renaming,
}: {
  readonly group: { readonly id: string; readonly name: string };
  readonly renaming: Renaming;
}): JSX.Element {
  if (!renaming.editing)
    return (
      <h1 className="order-2 min-w-0 flex-1 text-2xl font-bold break-words sm:text-3xl md:flex-initial">
        {group.name}
      </h1>
    );
  return (
    <div className="order-2 min-w-0 flex-1">
      <RenameGroupForm
        groupId={group.id}
        name={group.name}
        state={renaming.state}
        action={renaming.action}
        pending={renaming.pending}
        onCancel={renaming.close}
      />
    </div>
  );
}

/**
 * The group page's header (spec, A group; height budget in
 * docs/design/coach-shared-repertoire.md). One wrapping row, its items
 * placed by `order`: on a phone, back, the name and the account menu,
 * then the meta line with Rename at its right; from md, Rename sits
 * beside the name. Rename swaps the name for the form.
 */
export function GroupHeader({
  group,
  today,
  className,
}: {
  readonly group: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly assignments: readonly GroupAssignment[];
  };
  readonly today: string;
  readonly className?: string;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const renaming = useRenaming();
  return (
    <header
      className={`flex flex-wrap items-center gap-x-2 ${className ?? ''}`}
    >
      <BackLink />
      <NameOrForm group={group} renaming={renaming} />
      {renaming.editing ? null : (
        <button
          ref={renaming.buttonRef}
          type="button"
          onClick={renaming.open}
          className={`${TEXT_LINK} order-6 self-start font-semibold md:order-3 md:self-center`}
        >
          {t('rename')}
        </button>
      )}
      <div className="order-3 ml-auto md:hidden">
        <HeaderAccountMenu />
      </div>
      <div aria-hidden="true" className="order-4 basis-full md:order-5" />
      <p className="order-5 mt-1 min-w-0 flex-1 md:order-6">
        <GroupMeta
          memberCount={group.memberCount}
          assignments={group.assignments}
          today={today}
        />
      </p>
      <p role="status" className="sr-only">
        {renaming.saved && !renaming.editing ? t('saved') : ''}
      </p>
    </header>
  );
}
