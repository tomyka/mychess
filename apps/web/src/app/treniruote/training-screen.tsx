'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import {
  assignedRepertoirePath,
  repertoireRoute,
  ROUTES,
  trainingPath,
} from '../../lib/routes';
import type { TrainingData } from '../../server/training';
import type { FrameParts, TrainingLinks } from './drill';
import { EmptyPanel, type ScopedRepertoire } from './empty-panel';
import { LearnDrill } from './learn-drill';
import { ReviewDrill } from './review-drill';
import { SyncBanner } from './sync-banner';
import { TrainingFrame } from './training-frame';
import { startState } from './training-start';
import { useResultSync } from './use-result-sync';

export interface TrainingScreenProps {
  readonly data: TrainingData;
  /** The session account: its result queue is kept under its id. */
  readonly accountId: string;
  /** The repertoire the page is scoped to (R-142), or null for all of them. */
  readonly repertoireId: string | null;
}

/**
 * Where a session at this scope leads out to: the repertoire's own page
 * (an assigned one has its own path, decision 11), or home.
 */
const linksFor = (scoped: ScopedRepertoire | null): TrainingLinks => {
  if (scoped === null)
    return { back: ROUTES.home, learn: trainingPath('learn') };
  return {
    back:
      scoped.kind === 'own'
        ? repertoireRoute(scoped.id)
        : assignedRepertoirePath(scoped.id),
    learn: trainingPath('learn', scoped.id),
  };
};

/**
 * The training page (docs/design/training-screen.md): an empty state when
 * there is nothing to drill, else the mode's drill. It owns the result
 * queue, so the banner shows what waits from any drill.
 */
export function TrainingScreen({
  data,
  accountId,
  repertoireId,
}: TrainingScreenProps): JSX.Element {
  const t = useTranslations('training');
  const sync = useResultSync(accountId);
  // Decided once from the snapshot: a drill that empties its queue shows
  // its done summary, not an empty state.
  const [start] = useState(() => startState(data));
  const scoped = data.entries.find((e) => e.id === repertoireId) ?? null;
  const links = linksFor(scoped);
  const frame = (parts: FrameParts): JSX.Element => (
    <TrainingFrame
      {...parts}
      mode={data.mode}
      backHref={links.back}
      defaultTitle={scoped?.name ?? t(`title.${data.mode}`)}
      side={scoped?.side ?? 'white'}
      banner={
        <SyncBanner
          unsynced={sync.unsynced}
          onRetry={() => {
            sync.retry();
          }}
        />
      }
    />
  );
  if (start.kind !== 'drill')
    return frame({
      panel: (
        <EmptyPanel
          state={start}
          nextDue={data.nextDue}
          links={links}
          scoped={scoped}
        />
      ),
    });
  const Drill = data.mode === 'review' ? ReviewDrill : LearnDrill;
  return <Drill data={data} sync={sync} links={links} frame={frame} />;
}
