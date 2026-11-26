'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type JSX, type ReactNode } from 'react';
import { SECONDARY_BUTTON, TONAL_BUTTON } from '../buttons';
import { ConfirmedAction } from '../confirmed-action';
import { PendingButton } from '../pending-button';
import {
  knowCountAction,
  learnAgainAction,
  markKnownAction,
  type KnowCounts,
  type KnowOutcome,
} from '../repertoires/know-actions';
import { StatusLine } from '../status-line';

/** The form fields naming a move, a line or a chapter (know-actions.ts). */
export type KnowFields =
  | {
      readonly kind: 'move';
      readonly repertoireId: string;
      readonly moveKey: string;
    }
  | {
      readonly kind: 'line';
      readonly repertoireId: string;
      readonly chapterId: string;
      /** The line's index in `lines(graph, chapterId)`, in decimal. */
      readonly lineIndex: string;
    }
  | {
      readonly kind: 'chapter';
      readonly repertoireId: string;
      readonly chapterId: string;
    };

/** What the choice says after an action: a message key and its count. */
type Said =
  | { readonly kind: 'marked' | 'returned'; readonly count: number }
  | { readonly kind: 'refused' | 'failed' };

/** Counted, refused, failed, or still counting (null). */
type Counted = KnowCounts | { readonly ok: 'failed' } | null;

/** `fields` as one stable string, so a count follows the scope, not an object. */
const scopeOf = (fields: KnowFields): string =>
  new URLSearchParams(Object.entries(fields)).toString();

const formOf = (scope: string): FormData => {
  const form = new FormData();
  for (const [name, value] of new URLSearchParams(scope)) form.set(name, value);
  return form;
};

/** What an action's outcome says. */
const saidOf = (outcome: KnowOutcome, kind: 'marked' | 'returned'): Said =>
  outcome.ok ? { kind, count: outcome.changed } : { kind: 'refused' };

/**
 * The counts of `scope`, counted on mount and again whenever `version`
 * moves on; a count that comes back after the scope or the version has
 * changed is dropped. The two actions say their outcome, then `onActed`.
 */
function useKnow(scope: string, version: number, onActed: () => void) {
  const [counted, setCounted] = useState<Counted>(null);
  const [said, setSaid] = useState<Said | null>(null);
  useEffect(() => {
    let live = true;
    knowCountAction(formOf(scope)).then(
      (counts) => {
        if (live) setCounted(counts);
      },
      () => {
        if (live) setCounted({ ok: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [scope, version]);
  const act =
    (
      action: (form: FormData) => Promise<KnowOutcome>,
      kind: 'marked' | 'returned',
    ) =>
    async (form: FormData): Promise<void> => {
      try {
        setSaid(saidOf(await action(form), kind));
      } catch {
        setSaid({ kind: 'failed' });
      }
      onActed();
    };
  return {
    counted,
    said,
    know: act(markKnownAction, 'marked'),
    again: act(learnAgainAction, 'returned'),
  };
}

/** Did the last action change something (rather than fail or be refused)? */
const succeeded = (said: Said | null): boolean =>
  said?.kind === 'marked' || said?.kind === 'returned';

/** The status line's words for `said`. */
function useSaidText(said: Said | null): string | null {
  const t = useTranslations('training');
  if (said === null) return null;
  switch (said.kind) {
    case 'marked':
    case 'returned':
      return t(`know.${said.kind}`, { count: said.count });
    case 'refused':
      return t('notTrained');
    case 'failed':
      return t('know.failed');
  }
}

/** A form of hidden `fields` posting to `action` with one button. */
function ActionForm({
  fields,
  action,
  className,
  children,
}: {
  readonly fields: KnowFields;
  readonly action: (form: FormData) => Promise<void>;
  readonly className: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <form action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <PendingButton className={className}>{children}</PendingButton>
    </form>
  );
}

/**
 * "Mark known (n)": at once for a move; for a line or a chapter, after a
 * confirm that says how many moves (R-147).
 */
function KnowAction({
  fields,
  count,
  action,
}: {
  readonly fields: KnowFields;
  readonly count: number;
  readonly action: (form: FormData) => Promise<void>;
}): JSX.Element {
  const t = useTranslations('training.know');
  const label = t('markKnown', { count });
  if (fields.kind === 'move')
    return (
      <ActionForm fields={fields} action={action} className={TONAL_BUTTON}>
        {label}
      </ActionForm>
    );
  return (
    <ConfirmedAction
      // A new count is a new question: it starts closed.
      key={count}
      action={action}
      fields={fields}
      label={label}
      question={t('question', { count })}
      confirm={t('confirm')}
      cancel={t('cancel')}
      tone="primary"
      look="tonal"
    />
  );
}

/**
 * What a choice with nothing new to mark says, with its move count (R-227):
 * "Known (n moves)", or that all its moves are in review. A move, always
 * one, says it in the singular.
 */
function useStateText(): (
  kind: 'known' | 'nothing',
  moves: number | null,
) => string {
  const t = useTranslations('training.know');
  return (kind, moves) => {
    if (moves === null)
      return t(kind === 'known' ? 'knownMove' : 'nothingMove');
    return t(kind, { count: moves });
  };
}

/**
 * The choice's actions once counted: Mark known while it has new moves,
 * else "Known"; Learn again while it has skipped ones.
 */
function KnowBody({
  fields,
  moves,
  know,
}: {
  readonly fields: KnowFields;
  readonly moves: number | null;
  readonly know: ReturnType<typeof useKnow>;
}): JSX.Element {
  const t = useTranslations('training');
  const stateText = useStateText();
  const { counted } = know;
  if (counted === null)
    return <p className="text-fg-muted">{t('know.loading')}</p>;
  if (counted.ok === 'failed') return <p>{t('know.failed')}</p>;
  if (!counted.ok) return <p>{t('notTrained')}</p>;
  if (counted.know === 0 && counted.again === 0)
    return <p className="text-fg-muted">{stateText('nothing', moves)}</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {counted.know > 0 ? (
        <KnowAction fields={fields} count={counted.know} action={know.know} />
      ) : (
        <span className="text-fg-muted">{stateText('known', moves)}</span>
      )}
      {counted.again > 0 ? (
        <ActionForm
          fields={fields}
          action={know.again}
          className={SECONDARY_BUTTON}
        >
          {t('know.again', { count: counted.again })}
        </ActionForm>
      ) : null}
    </div>
  );
}

export interface KnowChoiceProps {
  readonly fields: KnowFields;
  /** What it is about, as it says it: "This move, 5... Qc7", "This line, 7 moves". */
  readonly subject: string;
  /** The player moves it covers; null for a move, which is always one. */
  readonly moves: number | null;
  /** Counts again whenever this moves on: after any choice's action. */
  readonly version: number;
  /** After an action, done or not: the parent moves `version` on. */
  readonly onActed: () => void;
}

/**
 * One of "I know this"'s choices (R-58, R-147, R-227): a move, a line or a
 * chapter, with Mark known and Learn again. Mounted only while "I know
 * this" is open, it counts the moves each would change as it mounts and
 * after any choice's action. Key it by its scope.
 */
export function KnowChoice({
  fields,
  subject,
  moves,
  version,
  onActed,
}: KnowChoiceProps): JSX.Element {
  const subjectId = useId();
  const know = useKnow(scopeOf(fields), version, onActed);
  const said = useSaidText(know.said);
  return (
    <div
      role="group"
      aria-labelledby={subjectId}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={subjectId}>{subject}</span>
        <KnowBody fields={fields} moves={moves} know={know} />
      </div>
      <StatusLine
        text={said}
        tone={succeeded(know.said) ? 'success' : 'error'}
      />
    </div>
  );
}
