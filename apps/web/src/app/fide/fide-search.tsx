'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useId, type JSX } from 'react';
import type { FideSearchState } from '../../server/fide-search';
import { PRIMARY_BUTTON } from '../buttons';
import { FIELD } from '../fields';
import { CARD } from '../surfaces';
import { StatusLine } from '../status-line';
import { submitByHand } from '../submit-by-hand';
import { startFideSearchAction } from './actions';
import { SearchResult } from './search-result';

const INITIAL: FideSearchState = { kind: 'idle' };

/**
 * The FIDE ID field and the search it starts (spec decision 5). The ID is
 * posted to a server action, never put in the URL. Each search's result is
 * keyed by its token, so a new search starts its own polling afresh.
 */
export function FideSearch({
  truncatedLimit,
}: {
  readonly truncatedLimit: number;
}): JSX.Element {
  const t = useTranslations();
  const statusId = useId();
  const [state, action, pending] = useActionState(
    startFideSearchAction,
    INITIAL,
  );
  // While the next search runs, the last refusal is no longer shown.
  const refused = state.kind === 'refused' && !pending ? state : undefined;
  const text =
    refused === undefined
      ? null
      : t(
          refused.refusal,
          refused.limit === undefined ? {} : { limit: refused.limit },
        );
  return (
    <>
      {/* noValidate: the server's refusal is shown in the page's language.
          method post: a submit before hydration must not put the ID in the
          URL, as a native GET would. */}
      <form
        method="post"
        noValidate
        aria-busy={pending}
        onSubmit={submitByHand(action)}
        className="flex flex-col gap-2"
      >
        <IdField error={text} pending={pending} statusId={statusId} />
      </form>
      {state.kind === 'started' ? (
        <SearchResult
          key={state.search.token}
          search={state.search}
          truncatedLimit={truncatedLimit}
        />
      ) : (
        <EmptyState />
      )}
    </>
  );
}

/** Until a search has found something: what a search shows (#381). */
function EmptyState(): JSX.Element {
  const t = useTranslations('fide');
  return <p className={`${CARD} p-6 text-fg-muted`}>{t('emptyState')}</p>;
}

/**
 * The ID field with its search button beside it on a wide screen, under
 * it and its hint on a phone; a numeric keyboard on touch devices. A
 * refusal shows right under the field, before the hint (#381).
 */
function IdField({
  error,
  pending,
  statusId,
}: {
  /** The refusal's text, or null: it marks the field and describes it. */
  readonly error: string | null;
  readonly pending: boolean;
  readonly statusId: string;
}): JSX.Element {
  const t = useTranslations('fide');
  const inputId = useId();
  const hintId = useId();
  const invalid = error !== null;
  return (
    <>
      <label htmlFor={inputId} className="font-medium">
        {t('idLabel')}
      </label>
      {/* In source order field, error, hint, button: stacked so on a
          phone; on a wide screen the button moves up beside the field, and
          the row stops at max-w-lg: an eight-digit ID needs no wide field.
          The error line is always there (a live region); while empty it is
          visually hidden and its box is `contents`, so it takes no row and
          no gap. The hint is placed after it by the grid. */}
      <div className="grid gap-x-3 gap-y-2 sm:max-w-lg sm:grid-cols-[1fr_auto]">
        <input
          id={inputId}
          type="text"
          name="fideId"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${statusId} ${hintId}` : hintId}
          className={`${FIELD} sm:col-start-1 sm:row-start-1`}
        />
        <div className={invalid ? 'sm:col-span-2 sm:row-start-2' : 'contents'}>
          <StatusLine id={statusId} text={error} tone="error" />
        </div>
        <p id={hintId} className="text-sm text-fg-muted sm:col-span-2">
          {t('idHint')}
        </p>
        <button
          type="submit"
          disabled={pending}
          className={`${PRIMARY_BUTTON} mt-1 sm:col-start-2 sm:row-start-1 sm:mt-0`}
        >
          {pending ? t('searching') : t('submit')}
        </button>
      </div>
    </>
  );
}
