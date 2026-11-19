import {
  LICHESS_GAME_URL,
  groupByColourAndFamily,
  openingVariation,
  type ColourSection,
  type OpeningFamilyGroup,
} from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, type JSX, type ReactNode } from 'react';
import type { SearchSnapshot } from '../../server/fide-search';
import { familyKey, useFamilyDisclosures } from './use-family-disclosures';

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

/** A game's Lichess link: a 44 px target, centred beside the opening. */
const GAME_LINK = 'inline-flex min-h-touch items-center text-accent underline';

/** Every badge has a border, so the outlined ones are no taller. */
const BADGE =
  'rounded-pill border border-transparent px-2 py-0.5 text-sm font-semibold';

/** A colour section's swatch, in the piece colours (tokens.css). */
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

/**
 * A game's result. The neutral ones are outlined (border-strong, 3:1): a
 * sunken fill all but vanished on the dark theme's card (#347).
 */
const OUTCOME_BADGE: Record<FoundGame['outcome'], string> = {
  win: `${BADGE} bg-success-subtle text-success`,
  draw: `${BADGE} border-border-strong text-fg`,
  loss: `${BADGE} bg-error-subtle text-error`,
  unknown: `${BADGE} border-dashed border-border-strong text-fg-muted`,
};

/** A group's score at a glance: its numbers in the results' colours. */
const SCORE_TAGS = {
  w: (chunks: ReactNode) => <span className="text-success">{chunks}</span>,
  d: (chunks: ReactNode) => <span className="text-fg">{chunks}</span>,
  l: (chunks: ReactNode) => <span className="text-error">{chunks}</span>,
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
      {groupByColourAndFamily(games).map((section) => (
        <ColourGroups key={section.colour} section={section} />
      ))}
      <Credit />
    </div>
  );
}

/** A colour's family groups, each kept open or closed by useFamilyDisclosures. */
function ColourGroups({
  section,
}: {
  readonly section: ColourSection<FoundGame>;
}): JSX.Element {
  const t = useTranslations('fide');
  const titleId = useId();
  const disclosures = useFamilyDisclosures(
    section.groups.map((group) => group.family),
  );
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="flex items-center gap-2 text-lg font-bold">
        <span aria-hidden="true" className={COLOUR_SWATCH[section.colour]} />
        {t(SECTION_TITLE[section.colour])}
      </h3>
      {section.groups.map((group) => (
        <FamilyGroup
          key={familyKey(group.family)}
          group={group}
          open={disclosures.isOpen(group.family)}
          onToggle={(open) => {
            disclosures.toggled(group.family, open);
          }}
        />
      ))}
    </section>
  );
}

/**
 * An opening family as a disclosure: its name, count and score, then its
 * games. The summary's focus ring follows the card's corners; hovering it
 * darkens the card's border to border-strong (a sunken fill vanished on dark).
 */
function FamilyGroup({
  group,
  open,
  onToggle,
}: {
  readonly group: OpeningFamilyGroup<FoundGame>;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}): JSX.Element {
  const t = useTranslations('fide');
  const score = { count: group.games.length, ...group.score };
  return (
    <details
      open={open}
      onToggle={(event) => {
        onToggle(event.currentTarget.open);
      }}
      className="group rounded-card border border-border bg-surface shadow-card has-[>summary:hover]:border-border-strong"
    >
      <summary className="flex min-h-touch cursor-pointer flex-col justify-center gap-1 rounded-card p-4">
        <span className="flex items-center justify-between gap-3 font-semibold break-words after:mr-1 after:size-2 after:shrink-0 after:rotate-45 after:border-r-2 after:border-b-2 after:border-fg-muted after:transition-transform after:content-[''] group-open:after:-rotate-135">
          {group.family ?? t('unknownOpening')}
        </span>
        {/* The numbers are for the eye; a screen reader hears the words. */}
        <span aria-hidden="true" className="text-sm text-fg-muted">
          {t.rich('groupGlance', { ...score, ...SCORE_TAGS })}
        </span>
        <span className="sr-only">{t('groupSummary', score)}</span>
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

/**
 * A found game, compact on a phone (#347): when and where; the opponent
 * with the result; the opening with the Lichess link beside it. The colour
 * is the section's, so no game repeats it (F1).
 */
function GameItem({ game }: { readonly game: FoundGame }): JSX.Element {
  const t = useTranslations('fide');
  const format = useFormatter();
  const { opponent } = game;
  const date =
    game.date === null
      ? t('dateUnknown')
      : format.dateTime(new Date(`${game.date}T00:00:00Z`), DATE_FORMAT);
  return (
    <li className="flex flex-col gap-1 px-4 pt-3 pb-1">
      <p className="text-sm text-fg-muted">
        {date} · {game.event}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">
          {opponent.fideId === null
            ? t('opponent', { name: opponent.name })
            : t('opponentWithId', {
                name: opponent.name,
                id: String(opponent.fideId),
              })}
        </span>
        <span className={OUTCOME_BADGE[game.outcome]}>{t(game.outcome)}</span>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Opening eco={game.eco} opening={game.opening} />
        {LICHESS_GAME.test(game.url) ? (
          <a
            href={game.url}
            target="_blank"
            rel="noopener noreferrer"
            className={GAME_LINK}
          >
            {t('openOnLichess')} <span className="sr-only">{t('newTab')}</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A game's opening inside its family's group: the ECO code and the
 * variation alone, since the group names the family (#347 F2); the whole
 * name when it has no variation.
 */
function Opening({
  eco,
  opening,
}: {
  readonly eco: string | null;
  readonly opening: string | null;
}): JSX.Element | null {
  const text = [eco, openingVariation(opening) ?? opening]
    .filter((part) => part !== null)
    .join(' ');
  return text === '' ? null : <p className="text-sm">{text}</p>;
}
