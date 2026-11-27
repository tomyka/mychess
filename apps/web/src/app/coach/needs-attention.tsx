import type { Attention } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath } from '../../lib/routes';
import type { AttentionCard } from '../../server/coach-pages';
import { SECTION_TITLE } from '../settings/styles';
import { CARD } from '../surfaces';
import { ROW_LINK } from './row-link';

/** Each reason's 3px left edge (spec, The dashboard). */
const EDGE = {
  overdue: 'border-l-error',
  deadlineNear: 'border-l-due',
  duePile: 'border-l-due',
  idle: 'border-l-border-strong',
} as const satisfies Record<Attention['kind'], string>;

type Messages = ReturnType<typeof useTranslations<'coach.attention'>>;

/** The reason in words (R-229). */
function reasonText(t: Messages, reason: Attention): string {
  switch (reason.kind) {
    case 'overdue': {
      const [only, ...rest] = reason.repertoires;
      return only === undefined || rest.length > 0
        ? t('overdueMany', { count: reason.repertoires.length })
        : t('overdue', { name: only, days: reason.days });
    }
    case 'deadlineNear':
      return t('deadlineNear', {
        name: reason.repertoire,
        days: reason.days,
        percent: reason.percent,
      });
    case 'duePile':
      return t('duePile', { count: reason.due });
    case 'idle':
      return t(reason.since === 'link' ? 'idleNever' : 'idle', {
        days: reason.days,
      });
  }
}

function Card({ card }: { readonly card: AttentionCard }): JSX.Element {
  const t = useTranslations('coach.attention');
  return (
    <li
      className={`${CARD} relative flex flex-col gap-1 border-l-3 p-4 ${EDGE[card.reason.kind]}`}
    >
      <Link href={coachPlayerPath(card.player.id)} className={ROW_LINK}>
        {card.player.displayName}
      </Link>
      <span className="text-sm text-fg-muted">
        {reasonText(t, card.reason)}
      </span>
    </li>
  );
}

/**
 * Who needs attention, most urgent first (R-229): one card per player,
 * each to their page. Nothing when nobody has a reason.
 */
export function NeedsAttention({
  cards,
}: {
  readonly cards: readonly AttentionCard[];
}): JSX.Element | null {
  const t = useTranslations('coach');
  const titleId = useId();
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('sectionCount', {
          title: t('attention.title'),
          count: cards.length,
        })}
      </h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.player.id} card={card} />
        ))}
      </ul>
    </section>
  );
}
