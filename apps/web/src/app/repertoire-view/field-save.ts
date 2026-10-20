'use client';

// Saving a panel field (the builder's comment, the Personal note): what a
// save came to, and what the field's status line says about it.
import { useMessages, useTranslations } from 'next-intl';
import { useState, useTransition, type KeyboardEvent } from 'react';
import { isMessageKey } from '../../i18n/message-key';

/** What saving a field came to: saved, or a catalogue key. */
export type FieldOutcome =
  { readonly ok: true } | { readonly ok: false; readonly refusal: string };

/** 'idle', 'saved', or the catalogue key of a refusal. */
type FieldStatus = string;

/** A field's save: its status, whether one is running, and the saver. */
interface FieldSave {
  readonly status: FieldStatus;
  readonly pending: boolean;
  readonly save: (text: string) => void;
}

/** Saves through `onSave` and keeps what the field's status line says. */
export function useFieldSave(
  onSave: (text: string) => Promise<FieldOutcome>,
): FieldSave {
  const [status, setStatus] = useState<FieldStatus>('idle');
  const [pending, startTransition] = useTransition();
  const save = (text: string): void => {
    startTransition(async () => {
      try {
        const outcome = await onSave(text);
        setStatus(outcome.ok ? 'saved' : outcome.refusal);
      } catch {
        setStatus('repertoires.failed');
      }
    });
  };
  return { status, pending, save };
}

/** What a field's status line says: `saved` on success, else the refusal. */
export function useStatusText(
  status: FieldStatus,
  saved: string,
): string | null {
  const t = useTranslations();
  const messages = useMessages();
  if (status === 'idle') return null;
  if (status === 'saved') return saved;
  return isMessageKey(messages, status) ? t(status) : t('repertoires.failed');
}

/** Ctrl/Cmd + Enter in a textarea saves it (docs/design, Keyboard). */
export const saveOnCtrlEnter =
  (save: () => void) =>
  (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    save();
  };
