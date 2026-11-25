'use client';

import { nextDue, startState, type LearnedMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';
import {
  assignedRepertoirePath,
  repertoireRoute,
  ROUTES,
  trainingPath,
} from '../../lib/routes';
import { dayOf } from '../../lib/training-day';
import type { TrainingData } from '../../lib/training-data';
import type { FrameParts, TrainingLinks } from './drill';
import { EmptyPanel, type ScopedRepertoire } from './empty-panel';
import { LearnDrill } from './learn-drill';
import { ReviewDrill } from './review-drill';
import { SyncBanner } from './sync-banner';
import { TrainingFrame } from './training-frame';
import { useQueuedLearned, useResultSync } from './use-result-sync';

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
    return {
      back: ROUTES.home,
      learn: trainingPath('learn'),
      review: trainingPath('review'),
    };
  return {
    back:
      scoped.kind === 'own'
        ? repertoireRoute(scoped.id)
        : assignedRepertoirePath(scoped.id),
    learn: trainingPath('learn', scoped.id),
    review: trainingPath('review', scoped.id),
  };
};

/**
 * The snapshot a learn session plans from, caught up with the moves the
 * browser learned but still queues (#330 decision 2), so they are not taught
 * again. A review keeps the snapshot: a queued move's Review in the browser
 * is only a placeholder, not the server's FSRS state, and it is not due for
 * a day anyway.
 */
const caughtUp = (
  data: TrainingData,
  queued: readonly LearnedMove[] | null,
): TrainingData =>
  data.mode !== 'learn' || queued === null || queued.length === 0
    ? data
    : { ...data, queued };

/** Does the session train several repertoires, not one (R-207)? */
const isMixed = (data: TrainingData, repertoireId: string | null): boolean =>
  repertoireId === null && data.entries.filter((e) => e.active).length > 1;

/**
 * A mixed session's header (R-207): titled as several repertoires, not by
 * the item's; that one still shows, under the title (R-54). With no item
 * (an empty state), the mode's title stays.
 */
const mixedTitle = (
  parts: FrameParts,
  several: string,
): { title?: string; subtitle?: string } =>
  parts.title === undefined ? {} : { title: several, subtitle: parts.title };

/**
 * The training page (docs/design/training-screen.md): an empty state when
 * there is nothing to drill, else the mode's drill. It owns the result
 * queue, so the banner shows what waits from any drill, and catches the
 * snapshot up with the learned moves it still queues.
 */
export function TrainingScreen({
  data: snapshot,
  accountId,
  repertoireId,
}: TrainingScreenProps): JSX.Element {
  const t = useTranslations('training');
  const sync = useResultSync(accountId);
  const queued = useQueuedLearned(accountId);
  const data = useMemo(() => caughtUp(snapshot, queued), [snapshot, queued]);
  const day = useMemo(() => dayOf(data), [data]);
  // Decided from the snapshot, and again once the queue is read; never
  // from the drill's progress: a drill that empties its queue shows its
  // done summary, not an empty state.
  const start = useMemo(
    () => startState(day, data.mode, data.now),
    [day, data],
  );
  const scoped = data.entries.find((e) => e.id === repertoireId) ?? null;
  const links = linksFor(scoped);
  const mixed = isMixed(data, repertoireId);
  const frame = (parts: FrameParts): JSX.Element => (
    <TrainingFrame
      {...parts}
      {...(mixed ? mixedTitle(parts, t('title.mixed')) : {})}
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
          nextDue={nextDue(day, data.now)}
          links={links}
          scoped={scoped}
        />
      ),
    });
  const Drill = data.mode === 'review' ? ReviewDrill : LearnDrill;
  return (
    <Drill
      // A drill starts again from the caught-up day: its state is set once.
      key={data === snapshot ? 'snapshot' : 'caught-up'}
      data={data}
      sync={sync}
      links={links}
      frame={frame}
    />
  );
}
