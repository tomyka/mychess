'use client';

import type { FidePlayer } from '@mychess/integrations';
import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { SearchProgress, StartedSearch } from '../../server/fide-search';
import { GameList } from './game-list';
import { useSearchProgress } from './use-search-progress';

/**
 * A started search: the player's header when Lichess gave one, how many
 * months are ready, the games found so far and, while a month is still
 * waiting, the polling that brings the rest in (spec decision 5).
 */
export function SearchResult({
  search,
  truncatedLimit,
}: {
  readonly search: StartedSearch;
  /** The most games a search lists (the index's cap). */
  readonly truncatedLimit: number;
}): JSX.Element {
  const t = useTranslations('fide');
  const titleId = useId();
  const { snapshot, expired } = useSearchProgress(search);
  const { progress, games, truncated } = snapshot;
  const id = String(search.fideId);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <PlayerHeader titleId={titleId} id={id} player={search.player} />
      <Progress progress={progress} expired={expired} />
      {truncated ? (
        <p className="text-fg-muted">
          {t('truncated', { limit: truncatedLimit })}
        </p>
      ) : null}
      {games.length > 0 ? (
        <GameList games={games} />
      ) : (
        <NoGames progress={progress} />
      )}
    </section>
  );
}

function PlayerHeader({
  titleId,
  id,
  player,
}: {
  readonly titleId: string;
  readonly id: string;
  readonly player: FidePlayer | null;
}): JSX.Element {
  const t = useTranslations('fide');
  if (player === null) {
    return (
      <h2 id={titleId} className="text-xl font-bold">
        {t('resultsTitle', { id })}
      </h2>
    );
  }
  const { federation, standardRating } = player;
  return (
    <header className="flex flex-col gap-1">
      <h2 id={titleId} className="text-xl font-bold">
        {player.name}
      </h2>
      <p className="text-fg-muted">
        {standardRating === null
          ? t('unrated', { id, federation })
          : t('rated', { id, federation, rating: String(standardRating) })}
      </p>
    </header>
  );
}

/**
 * What an empty list says (lead decisions). While a month waits: no games
 * in the ready months so far, once one is ready; before that the progress
 * speaks alone. Once nothing waits: no games, when at least one month was
 * searched; that no month could be searched, when none is ready.
 */
function NoGames({
  progress,
}: {
  readonly progress: SearchProgress;
}): JSX.Element | null {
  const t = useTranslations('fide');
  if (progress.waiting > 0) {
    return progress.ready > 0 ? (
      <p className="text-fg-muted">
        {t('noGamesYet', { count: progress.ready })}
      </p>
    ) : null;
  }
  return (
    <p className="text-fg-muted">
      {progress.ready > 0 ? t('noGames') : t('noMonths')}
    </p>
  );
}

/**
 * The months' progress. Only the "N of 12" line is announced as it changes
 * (#347), and the search's expiry when it comes; the rest is read in place.
 */
function Progress({
  progress,
  expired,
}: {
  readonly progress: SearchProgress;
  readonly expired: boolean;
}): JSX.Element {
  const t = useTranslations('fide');
  const { total, ready, waiting, unavailable } = progress;
  const percent = total === 0 ? 100 : Math.round((ready / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="font-medium">
        {t('monthsReady', { ready, total })}
      </p>
      <div
        aria-hidden="true"
        className="h-2 overflow-hidden rounded-pill bg-border"
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {unavailable > 0 ? (
        <p className="text-sm text-fg-muted">
          {t('monthsUnavailable', { count: unavailable })}
        </p>
      ) : null}
      {waiting > 0 && !expired ? (
        <p className="text-sm text-fg-muted">{t('monthsWaiting')}</p>
      ) : null}
      {/* Rendered from the start, so the expiry is announced when it fills;
          pulled up over the column's gap while empty (not hidden: a hidden
          live region may not be announced). */}
      <p role="status" className="-mt-2 text-sm not-empty:mt-0">
        {expired ? t('searchExpired') : null}
      </p>
    </div>
  );
}
