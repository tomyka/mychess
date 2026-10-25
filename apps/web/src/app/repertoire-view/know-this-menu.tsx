'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type JSX, type ReactNode } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { ConfirmedAction } from '../confirmed-action';
import { PendingButton } from '../pending-button';
import {
  knowCountAction,
  learnAgainAction,
  markKnownAction,
  type KnowCounts,
  type KnowOutcome,
} from '../repertuarai/know-actions';
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

const KNOW_LABEL = {
  move: 'knowMove',
  line: 'knowLine',
  chapter: 'knowChapter',
} as const;

const TOGGLE =
  'inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-control aria-expanded:bg-sunken';

/** What the menu says after an action: a message key and its count. */
type Said =
  | { readonly kind: 'marked' | 'returned'; readonly count: number }
  | { readonly kind: 'refused' | 'failed' };

/** Counted, refused, failed, or still counting (null). */
type Counted = KnowCounts | { readonly ok: 'failed' } | null;

const formOf = (fields: KnowFields): FormData => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

/** What an action's outcome says. */
const saidOf = (outcome: KnowOutcome, kind: 'marked' | 'returned'): Said =>
  outcome.ok ? { kind, count: outcome.changed } : { kind: 'refused' };

/** The counts of `fields` and the two actions, each counting again after. */
function useKnow(fields: KnowFields) {
  const [counted, setCounted] = useState<Counted>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const count = async (): Promise<void> => {
    try {
      setCounted(await knowCountAction(formOf(fields)));
    } catch {
      setCounted({ ok: 'failed' });
    }
  };
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
      await count();
    };
  return {
    counted,
    said,
    count,
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
  children,
}: {
  readonly fields: KnowFields;
  readonly action: (form: FormData) => Promise<void>;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <form action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <PendingButton className={SECONDARY_BUTTON}>{children}</PendingButton>
    </form>
  );
}

/**
 * "I know this": at once for a move; for a line or a chapter, after a
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
  const label = t(KNOW_LABEL[fields.kind]);
  if (fields.kind === 'move')
    return (
      <ActionForm fields={fields} action={action}>
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
    />
  );
}

/** The menu's body once counted: the actions there is something for. */
function KnowBody({
  fields,
  know,
}: {
  readonly fields: KnowFields;
  readonly know: ReturnType<typeof useKnow>;
}): JSX.Element | null {
  const t = useTranslations('training');
  const { counted } = know;
  if (counted === null)
    return <p className="text-fg-muted">{t('know.loading')}</p>;
  if (counted.ok === 'failed') return <p>{t('know.failed')}</p>;
  if (!counted.ok) return <p>{t('notTrained')}</p>;
  if (counted.know === 0 && counted.again === 0)
    return <p className="text-fg-muted">{t('know.nothing')}</p>;
  return (
    <div className="flex flex-wrap gap-3">
      {counted.know > 0 ? (
        <KnowAction fields={fields} count={counted.know} action={know.know} />
      ) : null}
      {counted.again > 0 ? (
        <ActionForm fields={fields} action={know.again}>
          {t('know.again', { count: counted.again })}
        </ActionForm>
      ) : null}
    </div>
  );
}

const CHECK = 'M8 12.5l3 3 5-6M12 3a9 9 0 100 18 9 9 0 000-18z';

export interface KnowThisMenuProps {
  readonly fields: KnowFields;
  /** What the toggle's accessible name says it is about. */
  readonly subject: string;
  /** What sits on the toggle's line, before it. */
  readonly children: ReactNode;
}

/**
 * "I know this" and "Learn again" on a move, a line or a chapter (R-58,
 * R-147), behind a toggle at the end of `children`'s line. Opening it
 * counts the moves each would change; an action shows its outcome and
 * counts again. Key it by its scope, so another scope starts closed.
 */
export function KnowThisMenu({
  fields,
  subject,
  children,
}: KnowThisMenuProps): JSX.Element {
  const t = useTranslations('training.know');
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const know = useKnow(fields);
  const said = useSaidText(know.said);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t('toggle', { subject })}
          title={t('toggle', { subject })}
          onClick={() => {
            if (!open) void know.count();
            setOpen(!open);
          }}
          className={TOGGLE}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d={CHECK} />
          </svg>
        </button>
      </div>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-2 pl-3">
          <KnowBody fields={fields} know={know} />
          <StatusLine
            text={said}
            tone={succeeded(know.said) ? 'success' : 'error'}
          />
        </div>
      ) : null}
    </div>
  );
}
