'use client';

import { useTranslations } from 'next-intl';
import { useActionState, type JSX } from 'react';
import { ConfirmedAction } from '../../../confirmed-action';
import { RefusalLine } from '../../../treneris/refusal-line';
import type { ForkState } from './actions';

/** The server action that forks the assignment, as useActionState takes it. */
export type ForkAction = (
  previous: ForkState,
  form: FormData,
) => Promise<ForkState>;

const INITIAL: ForkState = {};

/**
 * "Make my own copy" (R-20) behind a confirm step that says what it costs:
 * the copy is the player's, and the coach's edits no longer reach it
 * (R-128). A fork made goes to the copy's page; a refusal shows here.
 */
export function ForkCopy({
  repertoireId,
  name,
  action,
}: {
  readonly repertoireId: string;
  /** The repertoire's name, which the question names. */
  readonly name: string;
  readonly action: ForkAction;
}): JSX.Element {
  const t = useTranslations();
  const [state, fork] = useActionState(action, INITIAL);
  return (
    <div className="flex flex-col gap-2">
      <ConfirmedAction
        action={fork}
        fields={{ repertoireId }}
        label={t('assignment.fork.label')}
        question={t('assignment.fork.question', { name })}
        confirm={t('assignment.fork.confirm')}
        cancel={t('assignment.fork.cancel')}
        tone="primary"
      />
      <RefusalLine state={state} />
    </div>
  );
}
