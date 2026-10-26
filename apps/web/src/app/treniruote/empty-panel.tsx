'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { importIntoRoute, repertoireRoute, ROUTES } from '../../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttons';
import type { TrainingLinks } from './drill';
import { useReviewTime } from './review-time';
import type { StartState } from './training-start';

/** The repertoire a page is scoped to: which one, and whose. */
export interface ScopedRepertoire {
  readonly id: string;
  readonly kind: 'own' | 'assigned';
}

/** A start state with nothing to drill. */
type EmptyState = Exclude<StartState, { readonly kind: 'drill' }>;

/**
 * An empty state's section. On a desktop its heading sits in the side card
 * under the text-xl title, so it steps down to text-lg below a divider.
 */
function Empty({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby="training-empty"
      className="flex flex-col gap-3 lg:border-t lg:border-border lg:pt-4"
    >
      <h2 id="training-empty" className="text-xl font-semibold lg:text-lg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Review with nothing due: when the next one is, and the new moves on offer. */
function NothingDue({
  toLearn,
  nextDue,
  learnHref,
}: {
  readonly toLearn: number;
  readonly nextDue: Date | null;
  readonly learnHref: string;
}): JSX.Element {
  const t = useTranslations('training.empty.nothingDue');
  const reviewTime = useReviewTime();
  return (
    <Empty title={t('title')}>
      {nextDue === null ? null : (
        <p className="text-fg-muted">
          {t('next', { when: reviewTime(nextDue) })}
        </p>
      )}
      {toLearn > 0 ? (
        <Link href={learnHref} className={`${PRIMARY_BUTTON} self-start`}>
          {t('learn', { count: toLearn })}
        </Link>
      ) : null}
    </Empty>
  );
}

/**
 * No move of the player's side: the way to add some. An assigned
 * repertoire is the coach's to change, so it offers only the way back.
 */
function NoMoves({
  scoped,
}: {
  readonly scoped: ScopedRepertoire | null;
}): JSX.Element {
  const t = useTranslations('training.empty.noMoves');
  if (scoped === null)
    return (
      <Empty title={t('title')}>
        <p>{t('bodyAll')}</p>
        <Link
          href={ROUTES.repertoires}
          className={`${PRIMARY_BUTTON} self-start`}
        >
          {t('repertoires')}
        </Link>
      </Empty>
    );
  if (scoped.kind === 'assigned')
    return (
      <Empty title={t('title')}>
        <p>{t('bodyAssigned')}</p>
      </Empty>
    );
  return (
    <Empty title={t('title')}>
      <p>{t('body')}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={repertoireRoute(scoped.id)} className={PRIMARY_BUTTON}>
          {t('edit')}
        </Link>
        <Link href={importIntoRoute(scoped.id)} className={SECONDARY_BUTTON}>
          {t('import')}
        </Link>
      </div>
    </Empty>
  );
}

function Notice({
  kind,
}: {
  readonly kind: 'limitReached' | 'nothingLeft';
}): JSX.Element {
  const t = useTranslations(`training.empty.${kind}`);
  return (
    <Empty title={t('title')}>
      <p className="text-fg-muted">{t('body')}</p>
    </Empty>
  );
}

export interface EmptyPanelProps {
  readonly state: EmptyState;
  readonly nextDue: Date | null;
  readonly links: TrainingLinks;
  /** The repertoire the page is scoped to, if any. */
  readonly scoped: ScopedRepertoire | null;
}

/** The panel of an empty state (docs/design/training-screen.md, States). */
export function EmptyPanel({
  state,
  nextDue,
  links,
  scoped,
}: EmptyPanelProps): JSX.Element {
  switch (state.kind) {
    case 'nothingDue':
      return (
        <NothingDue
          toLearn={state.toLearn}
          nextDue={nextDue}
          learnHref={links.learn}
        />
      );
    case 'noMoves':
      return <NoMoves scoped={scoped} />;
    case 'limitReached':
    case 'nothingLeft':
      return <Notice kind={state.kind} />;
  }
}
