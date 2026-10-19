'use client';

import { useMessages, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type JSX } from 'react';
import { isMessageKey } from '../../../i18n/message-key';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../buttons';
import { SECTION } from '../../nustatymai/styles';
import { StatusLine } from '../../status-line';
import { ChosenFile, FileStep } from './file-step';
import { ImportSummary } from './import-summary';
import { TargetStep } from './target-step';
import {
  useImportFlow,
  type FlowMessage,
  type ImportFlow as Flow,
  type ImportOption,
} from './use-import-flow';

export type { ImportOption } from './use-import-flow';

const BYTES_PER_MB = 1024 * 1024;

/** A limit as the message names it: the byte limit in MB. */
const shownLimit = ({ key, limit }: FlowMessage): number | undefined =>
  key === 'pgn.tooLarge' && limit !== undefined ? limit / BYTES_PER_MB : limit;

/** Why Import is refused for the previewed target (R-115), or null. */
function previewRefusal({ preview }: Flow): FlowMessage | null {
  const refusal = preview?.refusal ?? null;
  return refusal === null ? null : { key: refusal };
}

/**
 * The flow's one status line: a refusal (the last request's, else the
 * preview's), or what a slow wait is for.
 */
function FlowStatus({
  id,
  flow,
}: {
  readonly id: string;
  readonly flow: Flow;
}): JSX.Element {
  const t = useTranslations();
  const messages = useMessages();
  const again = useRef<HTMLButtonElement>(null);
  const { slow, stale } = flow;
  const message = flow.message ?? previewRefusal(flow);
  useEffect(() => {
    if (stale) again.current?.focus();
  }, [stale]);
  let text: string | null = null;
  if (message !== null) {
    const limit = shownLimit(message);
    text = isMessageKey(messages, message.key)
      ? t(message.key, limit === undefined ? {} : { limit })
      : t('repertoires.failed');
  } else if (slow !== null) text = t(`repertoires.import.${slow}`);
  return (
    <div className="flex flex-col gap-2">
      <StatusLine id={id} text={text} tone={message ? 'error' : 'info'} />
      {stale ? (
        <button
          ref={again}
          type="button"
          onClick={flow.previewAgain}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('repertoires.import.previewAgain')}
        </button>
      ) : null}
    </div>
  );
}

/** Import, in a bottom bar on the phone (thumb zone), in the panel on a wide screen. */
function ConfirmBar({ flow }: { readonly flow: Flow }): JSX.Element {
  const t = useTranslations('repertoires.import');
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 bg-surface px-gutter pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sheet md:static md:z-auto md:bg-transparent md:p-0 md:shadow-none">
      <button
        type="button"
        disabled={flow.pending || previewRefusal(flow) !== null}
        onClick={flow.confirm}
        className={`${PRIMARY_BUTTON} w-full`}
      >
        {t('confirm')}
      </button>
    </div>
  );
}

/** Steps 2 and 3 once the file is previewed. */
function Previewed({
  flow,
  options,
}: {
  readonly flow: Flow;
  readonly options: readonly ImportOption[];
}): JSX.Element | null {
  const statusId = useId();
  const { upload, preview } = flow;
  if (upload === null || preview === null) return null;
  const nameInvalid = flow.message?.key.startsWith('repertoire.name') === true;
  return (
    <div className="flex flex-col gap-6 pb-24 md:pb-0">
      <ChosenFile
        name={upload.name}
        side={upload.side}
        onChange={flow.change}
      />
      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        <div className={`${SECTION} min-w-0 md:flex-1`}>
          <ImportSummary
            preview={preview}
            side={upload.side}
            busy={flow.pending && flow.busy === 'updating'}
            headingRef={flow.headingRef}
          />
        </div>
        <div className={`${SECTION} md:sticky md:top-8 md:w-panel md:shrink-0`}>
          <TargetStep
            options={options.filter((o) => o.side === upload.side)}
            side={upload.side}
            target={flow.target}
            name={flow.name}
            nameInvalid={nameInvalid}
            statusId={statusId}
            added={preview.refusal === null ? preview.target : null}
            onTarget={flow.chooseTarget}
            onName={(name) => {
              flow.dispatch({ type: 'set', patch: { name } });
            }}
          />
          <FlowStatus id={statusId} flow={flow} />
          <ConfirmBar flow={flow} />
        </div>
      </div>
    </div>
  );
}

export interface ImportFlowProps {
  /** The account's repertoires, the targets an upload can be added to. */
  readonly options: readonly ImportOption[];
  /** Opened from this repertoire (`?i=`): its side, and it as the target. */
  readonly preselected: string | null;
}

/**
 * The PGN import (docs/design/repertoire-screen.md, section 3): the file
 * and side, what it holds (R-64), where it goes (R-101), then Import.
 */
export function ImportFlow({
  options,
  preselected,
}: ImportFlowProps): JSX.Element {
  const flow = useImportFlow(options, preselected);
  const statusId = useId();
  if (flow.upload !== null) return <Previewed flow={flow} options={options} />;
  return (
    <FileStep
      file={flow.file}
      side={flow.side}
      sideFixed={flow.sideFixed}
      pending={flow.pending}
      fileRef={flow.fileRef}
      onFile={(file) => {
        flow.dispatch({ type: 'set', patch: { file } });
      }}
      onSide={(side) => {
        flow.dispatch({ type: 'set', patch: { side } });
      }}
      onSubmit={flow.submitFile}
      status={<FlowStatus id={statusId} flow={flow} />}
    />
  );
}
