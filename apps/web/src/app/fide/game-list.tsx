import { LICHESS_GAME_URL } from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { SearchSnapshot } from '../../server/fide-search';
import { TEXT_LINK } from '../nustatymai/styles';

type FoundGame = SearchSnapshot['games'][number];

/**
 * Only a Lichess game address, by the domain's rule, becomes a link. The
 * index keeps no other, so this is a second check at the point where the
 * address reaches the page.
 */
const LICHESS_GAME = new RegExp(LICHESS_GAME_URL);

const BADGE = 'rounded-pill px-2 py-0.5 text-sm font-semibold';

/** The piece colours, the same in light and dark theme (tokens.css). */
const COLOUR_BADGE: Record<FoundGame['colour'], string> = {
  white: `${BADGE} border border-piece-outline bg-piece-white text-piece-black`,
  black: `${BADGE} border border-piece-outline bg-piece-black text-piece-white`,
};

/** A game's date (`YYYY-MM-DD`, a calendar day) as the page's language writes it. */
const DATE_FORMAT = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
} as const;

const OUTCOME_BADGE: Record<FoundGame['outcome'], string> = {
  win: `${BADGE} bg-success-subtle text-success`,
  draw: `${BADGE} bg-sunken text-fg`,
  loss: `${BADGE} bg-error-subtle text-error`,
  unknown: `${BADGE} bg-sunken text-fg-muted`,
};

/** The games a search found, newest first, as the index ordered them. */
export function GameList({
  games,
}: {
  readonly games: readonly FoundGame[];
}): JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {games.map((game) => (
        <GameItem key={game.url} game={game} />
      ))}
    </ul>
  );
}

function GameItem({ game }: { readonly game: FoundGame }): JSX.Element {
  const t = useTranslations('fide');
  const format = useFormatter();
  const { opponent } = game;
  const date =
    game.date === null
      ? t('dateUnknown')
      : format.dateTime(new Date(`${game.date}T00:00:00Z`), DATE_FORMAT);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card">
      <p className="text-sm text-fg-muted">
        {date} · {game.event}
      </p>
      <p className="font-semibold">
        {opponent.fideId === null
          ? t('opponent', { name: opponent.name })
          : t('opponentWithId', {
              name: opponent.name,
              id: String(opponent.fideId),
            })}
      </p>
      {/* The badges are for the eye; a screen reader hears one sentence. */}
      <p aria-hidden="true" className="flex flex-wrap gap-2">
        <span className={COLOUR_BADGE[game.colour]}>{t(game.colour)}</span>
        <span className={OUTCOME_BADGE[game.outcome]}>{t(game.outcome)}</span>
      </p>
      <p className="sr-only">
        {t('played', { colour: game.colour, outcome: game.outcome })}
      </p>
      <Opening eco={game.eco} opening={game.opening} />
      {LICHESS_GAME.test(game.url) ? (
        <a
          href={game.url}
          target="_blank"
          rel="noopener noreferrer"
          className={TEXT_LINK}
        >
          {t('openOnLichess')} <span className="sr-only">{t('newTab')}</span>
        </a>
      ) : null}
    </li>
  );
}

function Opening({
  eco,
  opening,
}: {
  readonly eco: string | null;
  readonly opening: string | null;
}): JSX.Element | null {
  const text = [eco, opening].filter((part) => part !== null).join(' ');
  return text === '' ? null : <p className="text-sm">{text}</p>;
}
