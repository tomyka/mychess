import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import {
  coachProgressPath,
  coachSharedRepertoirePath,
  repertoireRoute,
} from '../../../../lib/routes';
import type {
  CoachPlayerPage,
  GrantedView,
  RepertoireCard,
} from '../../../../server/coach-pages';
import { Pill } from '../../../pill';
import { SECTION_TITLE, TEXT_LINK } from '../../../settings/styles';
import { CARD } from '../../../surfaces';
import { AssignmentStatusLine, liveStatus } from '../../assignment-status-line';
import { useOwnCopyTitle } from '../../own-copy-title';
import { ProgressCounts } from '../../progress-counts';
import { StateBar } from '../../state-bar';

/**
 * Progress, to the drill-down, and where the coach opens the repertoire:
 * their own, for an assignment; the player's, to add notes, otherwise (an
 * own copy opens its shared fork).
 */
function CardLinks({
  playerId,
  card,
  granted,
  titleId,
}: {
  readonly playerId: string;
  readonly card: RepertoireCard;
  readonly granted: GrantedView;
  readonly titleId: string;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const assigned = card.tag === 'assigned';
  return (
    <p className="flex flex-wrap gap-x-4">
      <Link
        href={coachProgressPath(playerId, granted.id)}
        aria-describedby={titleId}
        className={TEXT_LINK}
      >
        {t('title')}
      </Link>
      <Link
        href={
          assigned
            ? repertoireRoute(granted.id)
            : coachSharedRepertoirePath(playerId, granted.id)
        }
        aria-describedby={titleId}
        className={TEXT_LINK}
      >
        {assigned ? t('openRepertoire') : t('openShared')}
      </Link>
    </p>
  );
}

/** What the coach sees of the player's standing, or that the view ended (R-155). */
function CardProgress({
  player,
  card,
  titleId,
}: {
  readonly player: AccountRef;
  readonly card: RepertoireCard;
  readonly titleId: string;
}): JSX.Element {
  const t = useTranslations('coach.player');
  const { granted } = card;
  if (granted === null)
    return (
      <p className="text-sm text-fg-muted">
        {t('forkEnded', { name: player.displayName })}
      </p>
    );
  return (
    <>
      <StateBar counts={granted.standing.counts} size="row" />
      <ProgressCounts
        counts={granted.standing.counts}
        mastered={granted.standing.mastered}
      />
      <CardLinks
        playerId={player.id}
        card={card}
        granted={granted}
        titleId={titleId}
      />
    </>
  );
}

/** One repertoire: its title and tag, the assignment's status, its progress. */
function Card({
  player,
  card,
  today,
}: {
  readonly player: AccountRef;
  readonly card: RepertoireCard;
  readonly today: string;
}): JSX.Element {
  const tags = useTranslations('coach.progress.tag');
  const titleId = useId();
  const title = useOwnCopyTitle({
    isFork: card.tag === 'fork',
    playerName: player.displayName,
    repertoireName: card.repertoire.name,
  });
  const status = liveStatus(card.status);
  return (
    <li className={`${CARD} flex min-w-0 flex-col gap-2 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="font-semibold break-words">
          {title}
        </h3>
        <Pill tone="neutral">{tags(card.tag)}</Pill>
      </div>
      {status === null ? null : (
        <AssignmentStatusLine status={status} today={today} wording="due" />
      )}
      <CardProgress player={player} card={card} titleId={titleId} />
    </li>
  );
}

/**
 * One card per repertoire the coach may see (R-42, R-231), in the order
 * the loader gives: a list, one column on a phone and two from md.
 */
export function RepertoireCards({
  player,
}: {
  readonly player: CoachPlayerPage;
}): JSX.Element {
  const t = useTranslations('coach');
  const titleId = useId();
  const { cards } = player;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('sectionCount', {
          title: t('player.repertoires'),
          count: cards.length,
        })}
      </h2>
      {cards.length === 0 ? (
        <p className="text-fg-muted">
          {t('progress.empty', { name: player.displayName })}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {cards.map((card) => (
            <Card
              key={card.repertoire.id}
              player={player}
              card={card}
              today={player.today}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
