'use client';

import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { PRIMARY_BUTTON, QUIET_ACTION } from '../../../buttons';
import { FIELD } from '../../../fields';
import { PendingButton } from '../../../pending-button';
import { TEXT_LINK } from '../../../settings/styles';
import { addMemberAction, type CoachActionState } from '../../actions';
import { RefusalLine } from '../../refusal-line';

const NOT_ADDED: CoachActionState = {};

/** The group to add to: its id, its members and who could join it. */
interface AddTo {
  readonly id: string;
  readonly members: readonly AccountRef[];
  /** The coach's linked players not yet in the group (R-12). */
  readonly addable: readonly AccountRef[];
}

/**
 * The picker of linked players not yet in the group, opened in place; it
 * takes focus as it opens. A refused Add shows above it.
 */
function Picker({
  group,
  onCancel,
}: {
  readonly group: AddTo;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('coach.group');
  const fieldId = useId();
  const fieldRef = useRef<HTMLSelectElement>(null);
  const [state, add] = useActionState(addMemberAction, NOT_ADDED);
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <RefusalLine state={state} />
      <form action={add} className="flex flex-col gap-3">
        <input type="hidden" name="groupId" value={group.id} />
        <label htmlFor={fieldId} className="font-medium">
          {t('addLabel')}
        </label>
        <select ref={fieldRef} id={fieldId} name="playerId" className={FIELD}>
          {group.addable.map((player) => (
            <option key={player.id} value={player.id}>
              {player.displayName}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <PendingButton className={PRIMARY_BUTTON}>{t('add')}</PendingButton>
          <button type="button" onClick={onCancel} className={QUIET_ACTION}>
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Whether the picker is open; Cancel moves focus back to Add a player
 * (never on the first render).
 */
function usePicker(): {
  readonly open: boolean;
  readonly toggle: () => void;
  readonly cancel: () => void;
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
    cancel: () => {
      cancelled.current = true;
      setOpen(false);
    },
    buttonRef,
  };
}

/**
 * Add a player (R-12): opens the picker inline, or says why there is no
 * one to add: everyone linked is in, or nobody is linked yet.
 */
export function AddMember({ page }: { readonly page: AddTo }): JSX.Element {
  const t = useTranslations('coach');
  const pickerId = useId();
  const picker = usePicker();
  if (page.addable.length === 0)
    return (
      <p className="text-fg-muted">
        {page.members.length === 0 ? t('players.empty') : t('group.allIn')}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <button
        ref={picker.buttonRef}
        type="button"
        aria-expanded={picker.open}
        aria-controls={pickerId}
        onClick={picker.toggle}
        className={`${TEXT_LINK} font-semibold`}
      >
        {t('group.addTitle')}
      </button>
      <div id={pickerId} hidden={!picker.open}>
        {picker.open ? <Picker group={page} onCancel={picker.cancel} /> : null}
      </div>
    </div>
  );
}
