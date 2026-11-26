'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState, type JSX, type RefObject } from 'react';
import { importIntoRoute, repertoireRoute } from '../../../../lib/routes';
import type { AssignPanelData } from '../../../../server/coach-assignments';
import type { RepertoireSharing } from '../../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../../buttons';
import {
  DANGER_SECTION,
  SECTION,
  SECTION_TITLE,
} from '../../../settings/styles';
import { PageHeader } from '../../../shell/page-header';
import { StatusLine } from '../../../status-line';
import { CONTENT } from '../../../surfaces';
import { AssignPanel } from '../assign-panel';
import { DeleteConfirm } from '../delete-confirm';
import { RenameForm } from '../rename-form';
import { useReturnFocus, type Step } from './use-return-focus';
import type { Holders, Repertoire } from '../repertoire-types';
import { ShareWithCoach } from '../share-with-coach';
import { DownloadLink } from '../../download-link';

/** Rename, the PGN download and Add from PGN, as one wrapping row. */
function OwnActions({
  id,
  renameRef,
  onRename,
}: {
  readonly id: string;
  readonly renameRef: RefObject<HTMLButtonElement | null>;
  readonly onRename: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.manage');
  return (
    <div className="flex flex-wrap gap-2">
      <button
        ref={renameRef}
        type="button"
        onClick={onRename}
        className={SECONDARY_BUTTON}
      >
        {t('rename')}
      </button>
      <DownloadLink id={id} />
      <Link href={importIntoRoute(id)} className={SECONDARY_BUTTON}>
        {t('importInto')}
      </Link>
    </div>
  );
}

/** The screen's one open step and what moves it, with focus returned. */
interface Steps {
  readonly step: Step;
  readonly set: (step: Step) => void;
  readonly focus: ReturnType<typeof useReturnFocus>;
}

function useSteps(): Steps {
  const [step, set] = useState<Step>('idle');
  return { step, set, focus: useReturnFocus(step) };
}

/** The repertoire's own section: rename in place, download, add from PGN. */
function OwnSection({
  repertoire,
  steps,
}: {
  readonly repertoire: Repertoire;
  readonly steps: Steps;
}): JSX.Element {
  const t = useTranslations('repertoires.manage');
  const titleId = useId();
  const { step, set, focus } = steps;
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('section')}
      </h2>
      {step === 'renaming' ? (
        <RenameForm
          {...repertoire}
          onDone={() => {
            set('renamed');
          }}
          onCancel={() => {
            set('idle');
          }}
        />
      ) : (
        <OwnActions
          id={repertoire.id}
          renameRef={focus.rename}
          onRename={() => {
            set('renaming');
          }}
        />
      )}
      <StatusLine
        text={step === 'renamed' ? t('renamed') : null}
        tone="success"
      />
    </section>
  );
}

/** Delete, apart in the error colour, behind the two-step confirmation. */
function DangerSection({
  repertoire,
  assignedPlayers,
  steps,
}: {
  readonly repertoire: Repertoire;
  readonly steps: Steps;
} & Holders): JSX.Element {
  const t = useTranslations('repertoires.manage');
  const titleId = useId();
  const { step, set, focus } = steps;
  return (
    <section aria-labelledby={titleId} className={DANGER_SECTION}>
      <h2 id={titleId} className={`${SECTION_TITLE} text-error`}>
        {t('deleteTitle')}
      </h2>
      {step === 'deleting' ? (
        <DeleteConfirm
          {...repertoire}
          assignedPlayers={assignedPlayers}
          onCancel={() => {
            set('idle');
          }}
        />
      ) : (
        <button
          ref={focus.remove}
          type="button"
          onClick={() => {
            set('deleting');
          }}
          className={`${SECONDARY_BUTTON} self-start border-error text-error`}
        >
          {t('delete')}
        </button>
      )}
    </section>
  );
}

/**
 * The Repertoire screen of an own repertoire (R-226): rename, download
 * PGN and add from PGN; sharing with a coach; in Coach mode whom it is
 * assigned to, with each player's progress (R-225); then delete, apart.
 */
export function ManageScreen({
  repertoire,
  sharing,
  assignedPlayers,
  assignPanel,
}: {
  readonly repertoire: Repertoire;
  readonly sharing: RepertoireSharing;
  /** The assign panel's data; null with Coach mode off. */
  readonly assignPanel: AssignPanelData | null;
} & Holders): JSX.Element {
  const steps = useSteps();
  return (
    <main className={`${CONTENT} gap-8`}>
      <PageHeader
        back={{ href: repertoireRoute(repertoire.id), parent: repertoire.name }}
        title={repertoire.name}
      />
      <OwnSection repertoire={repertoire} steps={steps} />
      <ShareWithCoach repertoireId={repertoire.id} sharing={sharing} />
      {assignPanel === null ? null : (
        <AssignPanel repertoireId={repertoire.id} data={assignPanel} />
      )}
      <DangerSection
        repertoire={repertoire}
        assignedPlayers={assignedPlayers}
        steps={steps}
      />
    </main>
  );
}
