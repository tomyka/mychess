'use client';

import { useMessages, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type JSX } from 'react';
import { isMessageKey } from '../../../i18n/message-key';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { SECTION } from '../../settings/styles';
import { StatusLine } from '../../status-line';
import { ChosenFile, FileStep } from './file-step';
import { ImportSummary } from './import-summary';
import type { ImportOption } from './import-flow-state';
import { TargetStep } from './target-step';
import {
  useImportFlow,
  type PreviewedView,
  type StatusView,
} from './use-import-flow';

/**
 * The flow's one status line: the refusal the flow shows, or what a slow
 * wait is for; "Preview again" when the repertoire changed.
 */
function FlowStatus({
  id,
  status,
}: {
  readonly id: string;
  readonly status: StatusView;
}): JSX.Element {
  const t = useTranslations();
  const messages = useMessages();
  const again = useRef<HTMLButtonElement>(null);
  const { message, slow, stale } = status;
  useEffect(() => {
    if (stale) again.current?.focus();
  }, [stale]);
  let text: string | null = null;
  if (message !== null) {
    const { key, limit } = message;
    text = isMessageKey(messages, key)
      ? t(key, limit === undefined ? {} : { limit })
      : t('repertoires.failed');
  } else if (slow !== null) text = t(`repertoires.import.${slow}`);
  return (
    <div className="flex flex-col gap-2">
      <StatusLine id={id} text={text} tone={message ? 'error' : 'info'} />
      {stale ? (
        <button
          ref={again}
          type="button"
          onClick={status.onPreviewAgain}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('repertoires.import.previewAgain')}
        </button>
      ) : null}
    </div>
  );
}

/** Import, in a bottom bar on the phone (thumb zone), in the panel on a wide screen. */
function ConfirmBar({
  confirm,
}: {
  readonly confirm: PreviewedView['confirm'];
}): JSX.Element {
  const t = useTranslations('repertoires.import');
  return (
    <div className="fixed inset-x-0 bottom-[var(--shell-chrome,0px)] z-10 bg-surface px-gutter py-3 shadow-sheet md:static md:z-auto md:bg-transparent md:p-0 md:shadow-none">
      <button
        type="button"
        disabled={confirm.disabled}
        onClick={confirm.onConfirm}
        className={`${PRIMARY_BUTTON} w-full`}
      >
        {t('confirm')}
      </button>
    </div>
  );
}

/** Steps 2 and 3 once the file is previewed. */
function Previewed({
  view,
  status,
}: {
  readonly view: PreviewedView;
  readonly status: StatusView;
}): JSX.Element {
  const statusId = useId();
  return (
    <div className="flex flex-col gap-6 pb-24 md:pb-0">
      <ChosenFile {...view.chosen} />
      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        <div className={`${SECTION} min-w-0 md:flex-1`}>
          <ImportSummary {...view.summary} />
        </div>
        <div className={`${SECTION} md:sticky md:top-8 md:w-panel md:shrink-0`}>
          <TargetStep step={view.target} statusId={statusId} />
          <FlowStatus id={statusId} status={status} />
          <ConfirmBar confirm={view.confirm} />
        </div>
      </div>
    </div>
  );
}

export interface ImportFlowProps {
  /** The account's repertoires, the targets an upload can be added to. */
  readonly options: readonly ImportOption[];
  /**
   * The account's repertoire it was opened from (`?i=`), if any: its side,
   * and it as the target.
   */
  readonly opened: ImportOption | null;
  /**
   * The account's names a file's players may give it by: the side's
   * default is the one they name it on (#330 decision 8).
   */
  readonly names: readonly string[];
}

/**
 * The PGN import (docs/design/repertoire-screen.md, section 3): the file
 * or pasted PGN (R-209) and side, what it holds (R-64), where it goes
 * (R-101), then Import.
 */
export function ImportFlow({
  options,
  opened,
  names,
}: ImportFlowProps): JSX.Element {
  const flow = useImportFlow(options, opened, names);
  const statusId = useId();
  if (flow.previewed !== null) {
    return <Previewed view={flow.previewed} status={flow.status} />;
  }
  return (
    <FileStep
      step={flow.fileStep}
      status={<FlowStatus id={statusId} status={flow.status} />}
    />
  );
}
