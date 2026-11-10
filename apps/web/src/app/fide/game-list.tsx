import {
  LICHESS_GAME_URL,
  groupForPreparation,
  type OpeningFamilyGroup,
  type PreparationSection,
} from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, type JSX, type ReactNode } from 'react';
import type { SearchSnapshot } from '../../server/fide-search';
import { TEXT_LINK } from '../nustatymai/styles';

type FoundGame = SearchSnapshot['games'][number];

/**
 * Only a Lichess game address, by the domain's rule, becomes a link. The
 * index keeps no other, so this is a second check at the point where the
 * address reaches the page.
 */
const LICHESS_GAME = new RegExp(LICHESS_GAME_URL);

/** Where the credit of the games' source and licence links (#348). */
const CREDIT_LINKS = {
  broadcasts: 'https://lichess.org/broadcast',
  licence: 'https://creativecommons.org/licenses/by-sa/4.0/',
} as const;

/**
 * How many of a colour's groups start open: the first two in the domain's
 * order (most games first, unknown opening last), so a phone shows the main
 * lines at once and the rest as one-line summaries.
 */
const OPEN_GROUPS = 2;

const BADGE = 'rounded-pill px-2 py-0.5 text-sm font-semibold';

/** The piece colours, the same in light and dark theme (tokens.css). */
const COLOUR_BADGE: Record<FoundGame['colour'], string> = {
  white: `${BADGE} border border-piece-outline bg-piece-white text-piece-black`,
  black: `${BADGE} border border-piece-outline bg-piece-black text-piece-white`,
};

/** A colour section's swatch, in the same piece colours. */
const COLOUR_SWATCH: Record<FoundGame['colour'], string> = {
  white:
    'size-4 shrink-0 rounded-pill border border-piece-outline bg-piece-white',
  black:
    'size-4 shrink-0 rounded-pill border border-piece-outline bg-piece-black',
};

const SECTION_TITLE: Record<FoundGame['colour'], 'asWhite' | 'asBlack'> = {
  white: 'asWhite',
  black: 'asBlack',
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

/**
 * The games a search found, as the domain groups them for preparation
 * (R-189, R-190): as White, then as Black, one disclosure per opening
 * family; then the credit of their source and licence.
 */
export function GameList({
  games,
}: {
  readonly games: readonly FoundGame[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {groupForPreparation(games).map((section) => (
        <ColourSection key={section.colour} section={section} />
      ))}
      <Credit />
    </div>
  );
}

function ColourSection({
  section,
}: {
  readonly section: PreparationSection<FoundGame>;
}): JSX.Element {
  const t = useTranslations('fide');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="flex items-center gap-2 text-lg font-bold">
        <span aria-hidden="true" className={COLOUR_SWATCH[section.colour]} />
        {t(SECTION_TITLE[section.colour])}
      </h3>
      {section.groups.map((group, index) => (
        <FamilyGroup
          key={group.family ?? ''}
          group={group}
          open={index < OPEN_GROUPS}
        />
      ))}
    </section>
  );
}

/** An opening family as a disclosure: its name, count and score, then its games. */
function FamilyGroup({
  group,
  open,
}: {
  readonly group: OpeningFamilyGroup<FoundGame>;
  readonly open: boolean;
}): JSX.Element {
  const t = useTranslations('fide');
  const { score } = group;
  return (
    <details
      open={open}
      className="group rounded-card border border-border bg-surface shadow-card"
    >
      <summary className="flex min-h-touch cursor-pointer flex-col justify-center gap-1 p-4">
        <span className="flex items-center justify-between gap-3 font-semibold break-words after:mr-1 after:size-2 after:shrink-0 after:rotate-45 after:border-r-2 after:border-b-2 after:border-fg-muted after:transition-transform after:content-[''] group-open:after:-rotate-135">
          {group.family ?? t('unknownOpening')}
        </span>
        <span className="text-sm text-fg-muted">
          {t('groupSummary', { count: group.games.length, ...score })}
        </span>
      </summary>
      <ul className="flex flex-col divide-y divide-border border-t border-border">
        {group.games.map((game) => (
          <GameItem key={game.url} game={game} />
        ))}
      </ul>
    </details>
  );
}

/** The games' source and licence (#348): Lichess broadcasts, CC BY-SA 4.0. */
function Credit(): JSX.Element {
  const t = useTranslations('fide');
  return (
    <p className="text-sm text-fg-muted">
      {t.rich('credit', {
        broadcasts: (chunks) => (
          <ExternalLink href={CREDIT_LINKS.broadcasts}>{chunks}</ExternalLink>
        ),
        licence: (chunks) => (
          <ExternalLink href={CREDIT_LINKS.licence}>{chunks}</ExternalLink>
        ),
      })}
    </p>
  );
}

function ExternalLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations('fide');
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent"
    >
      {/* Only the text is underlined, not the space before the hint. */}
      <span className="underline">{children}</span>{' '}
      <span className="sr-only">{t('newTab')}</span>
    </a>
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
    <li className="flex flex-col gap-2 p-4">
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
