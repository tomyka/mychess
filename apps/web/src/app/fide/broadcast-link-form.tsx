'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, useState, type JSX } from 'react';
import type { BroadcastLinkState } from '../../server/broadcast-link';
import { PRIMARY_BUTTON } from '../buttons';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { addBroadcastLinkAction } from './actions';

const INITIAL: BroadcastLinkState = { kind: 'idle' };

/** What the status line says of `state`, in the page's language. */
function useStatusText(state: BroadcastLinkState): string | null {
  const t = useTranslations();
  switch (state.kind) {
    case 'idle':
      return null;
    case 'added':
      return t('fide.broadcastAdded', { name: state.name });
    case 'known':
      return t('fide.broadcastKnown', { name: state.name });
    case 'refused':
      return t(
        state.refusal,
        state.limit === undefined ? {} : { limit: state.limit },
      );
  }
}

/**
 * "Add a Lichess broadcast" (#349, R-197, spec decision 4): a signed-in
 * user pastes the link of a finished tournament, or of one of its rounds,
 * so its games join the searches once fetched. The link is posted to a
 * server action; the field keeps it when it is refused and is emptied
 * once it is added, so a second tap sends nothing again. While a link is
 * being added the last refusal is not shown.
 */
export function BroadcastLinkForm(): JSX.Element {
  const t = useTranslations('fide');
  const titleId = useId();
  const statusId = useId();
  // A new field after each link added: it starts empty.
  const [fieldKey, setFieldKey] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: BroadcastLinkState, form: FormData) => {
      const next = await addBroadcastLinkAction(previous, form);
      if (next.kind === 'added' || next.kind === 'known') {
        setFieldKey((key) => key + 1);
      }
      return next;
    },
    INITIAL,
  );
  const statusText = useStatusText(state);
  const invalid = state.kind === 'refused' && !pending;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-xl font-bold">
          {t('addTitle')}
        </h2>
        <p className="text-fg-muted">{t('addIntro')}</p>
      </div>
      {/* noValidate and method post as for the FIDE ID search. */}
      <form
        method="post"
        noValidate
        aria-busy={pending}
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-2"
      >
        <LinkField
          fieldKey={fieldKey}
          invalid={invalid}
          pending={pending}
          statusId={statusId}
        />
      </form>
      <StatusLine
        id={statusId}
        text={pending ? null : statusText}
        tone={invalid ? 'error' : 'success'}
      />
    </section>
  );
}

/**
 * The link field with its Add button beside it on a wide screen, under it
 * and its hint on a phone; a URL keyboard on touch devices.
 */
function LinkField({
  fieldKey,
  invalid,
  pending,
  statusId,
}: {
  /**
   * Changes once a link is added: the input alone is made anew, empty,
   * so the button keeps its focus.
   */
  readonly fieldKey: number;
  /** Marks the field and points it at the status line's refusal. */
  readonly invalid: boolean;
  readonly pending: boolean;
  readonly statusId: string;
}): JSX.Element {
  const t = useTranslations('fide');
  const inputId = useId();
  const hintId = useId();
  return (
    <>
      <label htmlFor={inputId} className="font-medium">
        {t('linkLabel')}
      </label>
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[1fr_auto]">
        <input
          key={fieldKey}
          id={inputId}
          type="url"
          name="link"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${hintId} ${statusId}` : hintId}
          className="min-h-touch min-w-0 rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error sm:col-start-1 sm:row-start-1"
        />
        <p
          id={hintId}
          className="text-sm break-words text-fg-muted sm:col-span-2 sm:row-start-2"
        >
          {t('linkHint')}
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`${PRIMARY_BUTTON} mt-1 sm:col-start-2 sm:row-start-1 sm:mt-0`}
        >
          {pending ? t('adding') : t('addSubmit')}
        </button>
      </div>
    </>
  );
}
