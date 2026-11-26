import { SIDES, type Side } from '@mychess/chess';
import { byName, vilniusDay, type BadgeSet } from '@mychess/domain';
import {
  useFormatter,
  useTranslations,
  type DateTimeFormatOptions,
} from 'next-intl';
import Link from 'next/link';
import { Fragment, useId, type JSX } from 'react';
import { CLOCK, shortDateFormat } from '../../lib/date-format';
import { assignedRepertoirePath, repertoireRoute } from '../../lib/routes';
import type { AssignedListItem } from '../../server/assignment-pages';
import type { TrainedStanding } from '../../server/training';
import { AssignmentBadges } from '../assignment-badges';
import { SideKing } from '../side-king';
import { StandingLine } from '../standing-line';
import { useDeadline } from '../use-deadline';
import { CARD } from '../surfaces';

/** A card on the list: the whole card is the link to its page. */
const LIST_CARD = `${CARD} flex min-h-touch flex-col gap-2 p-4`;

/** One repertoire as My repertoires lists it. */
export interface RepertoireCard {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  readonly chapters: number;
  readonly moves: number;
  readonly updatedAt: Date;
  /** The coach whose assignment this is a Fork of (R-135, #328); null when it is none. */
  readonly forkCoachName: string | null;
  /** How many players have it from the viewer as their coach (R-225); 0 when none. */
  readonly assignedTo: number;
}

/** The training standings of what the viewer trains, by repertoire id. */
type Standings = ReadonlyMap<string, TrainedStanding>;

/** What every card shows, whatever its kind. */
interface CardView {
  readonly href: string;
  readonly name: string;
  readonly tag: 'assigned' | 'fork' | null;
  /** The meta line's parts, already worded. */
  readonly meta: readonly string[];
  /** An assignment's badges (Overdue, Paused, Updated), or null. */
  readonly badges: BadgeSet | null;
  /** Its standing, when the viewer trains it. */
  readonly standing: TrainedStanding | undefined;
}

/**
 * How "changed" shows a time (docs/design/repertoire-screen.md): today as a
 * 24-hour time, this year as day and month, older with the year.
 */
const changedFormat = (updatedAt: Date, now: Date): DateTimeFormatOptions =>
  vilniusDay(updatedAt) === vilniusDay(now)
    ? CLOCK
    : shortDateFormat(updatedAt, now);

/** An own card's meta line: counts, change, a fork's coach, assignees. */
function useOwnMeta(item: RepertoireCard, now: Date): string[] {
  const t = useTranslations('repertoires.list');
  const format = useFormatter();
  const changed = format.dateTime(
    item.updatedAt,
    changedFormat(item.updatedAt, now),
  );
  return [
    t('meta', { chapters: item.chapters, moves: item.moves }),
    t('changed', { date: changed }),
    ...(item.forkCoachName === null
      ? []
      : [t('forkOf', { coach: item.forkCoachName })]),
    ...(item.assignedTo > 0
      ? [t('assignedTo', { count: item.assignedTo })]
      : []),
  ];
}

/** An assigned card's meta line: its coach, deadline (R-51) and size. */
function useAssignedMeta(item: AssignedListItem, now: Date): string[] {
  const t = useTranslations('repertoires.list');
  const date = useDeadline((day) => shortDateFormat(day, now));
  return [
    item.coachName,
    item.deadline === null
      ? t('noDeadline')
      : t('due', { date: date(item.deadline) }),
    t('meta', { chapters: item.chapters, moves: item.moves }),
  ];
}

const TAG_STYLE = {
  assigned: 'bg-accent-subtle text-accent',
  fork: 'bg-sunken text-fg-muted',
} as const;

const TAG_KEY = { assigned: 'tagAssigned', fork: 'tagFork' } as const;

/**
 * The pill after the name: Assigned or Own copy; none on an own card. The
 * same size as the badges beside it (assignment-badges.tsx).
 */
function Tag({ tag }: { readonly tag: CardView['tag'] }): JSX.Element | null {
  const t = useTranslations('repertoires.list');
  if (tag === null) return null;
  return (
    <span
      className={`rounded-pill border border-transparent px-2 py-0.5 text-sm font-semibold ${TAG_STYLE[tag]}`}
    >
      {t(TAG_KEY[tag])}
    </span>
  );
}

/** The meta line, its parts separated by a middle dot. */
function MetaLine({
  id,
  parts,
}: {
  readonly id: string;
  readonly parts: readonly string[];
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <span id={id} className="text-sm text-fg-muted">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index === 0 ? null : t('separator')}
          <span>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * One card of any kind (R-225): the name line (the name, two lines at
 * most, in full in its title and accessible name; its tag; an
 * assignment's badges), the meta line and the standing. The whole card is
 * the link.
 */
function CardLink({ view }: { readonly view: CardView }): JSX.Element {
  const nameId = useId();
  const metaId = useId();
  const standingId = useId();
  const { standing } = view;
  return (
    <Link
      href={view.href}
      aria-labelledby={nameId}
      aria-describedby={
        standing === undefined ? metaId : `${metaId} ${standingId}`
      }
      title={view.name}
      className={LIST_CARD}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={nameId} className="line-clamp-2 text-base font-semibold">
          {view.name}
        </span>
        <Tag tag={view.tag} />
        {view.badges === null ? null : <AssignmentBadges flags={view.badges} />}
      </span>
      <MetaLine id={metaId} parts={view.meta} />
      {standing === undefined ? null : (
        <span id={standingId}>
          <StandingLine standing={standing.standing} due={standing.due} />
        </span>
      )}
    </Link>
  );
}

function OwnCard({
  item,
  now,
  standings,
}: {
  readonly item: RepertoireCard;
  readonly now: Date;
  readonly standings: Standings;
}): JSX.Element {
  const meta = useOwnMeta(item, now);
  return (
    <CardLink
      view={{
        href: repertoireRoute(item.id),
        name: item.name,
        tag: item.forkCoachName === null ? null : 'fork',
        meta,
        badges: null,
        standing: standings.get(item.id),
      }}
    />
  );
}

/** A repertoire a coach assigned to the player (#328). */
function AssignedCard({
  item,
  now,
  standings,
}: {
  readonly item: AssignedListItem;
  readonly now: Date;
  readonly standings: Standings;
}): JSX.Element {
  const meta = useAssignedMeta(item, now);
  return (
    <CardLink
      view={{
        href: assignedRepertoirePath(item.repertoireId),
        name: item.name,
        tag: 'assigned',
        meta,
        badges: item.badges,
        standing: standings.get(item.repertoireId),
      }}
    />
  );
}

const EMPTY_KEY = { white: 'emptyWhite', black: 'emptyBlack' } as const;

/** One card of a side: the account's own repertoire or an assigned one. */
type Entry =
  | { readonly kind: 'own'; readonly item: RepertoireCard }
  | { readonly kind: 'assigned'; readonly item: AssignedListItem };

const keyOf = (entry: Entry): string =>
  entry.kind === 'own' ? entry.item.id : entry.item.repertoireId;

const byEntryName = byName((entry: Entry) => ({
  name: entry.item.name,
  id: keyOf(entry),
}));

function SideGroup({
  side,
  entries,
  standings,
  now,
}: {
  readonly side: Side;
  readonly entries: readonly Entry[];
  readonly standings: Standings;
  readonly now: Date;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2
        id={titleId}
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <SideKing side={side} />
        {t(side)}
      </h2>
      {entries.length === 0 ? (
        <p className="text-fg-muted">{t(EMPTY_KEY[side])}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={keyOf(entry)}>
              {entry.kind === 'own' ? (
                <OwnCard item={entry.item} now={now} standings={standings} />
              ) : (
                <AssignedCard
                  item={entry.item}
                  now={now}
                  standings={standings}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The account's repertoires and those assigned to it (#328) by side, White
 * then Black, each sorted by name in English order (R-160, R-217), each
 * with its standing where the viewer trains it (R-225); one line when there
 * are none at all.
 */
export function RepertoireList({
  items,
  assigned,
  standings,
  now,
}: {
  readonly items: readonly RepertoireCard[];
  readonly assigned: readonly AssignedListItem[];
  readonly standings: Standings;
  readonly now: Date;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const entries: Entry[] = [
    ...items.map((item) => ({ kind: 'own', item }) as const),
    ...assigned.map((item) => ({ kind: 'assigned', item }) as const),
  ].toSorted(byEntryName);
  if (entries.length === 0)
    return <p className="text-fg-muted">{t('empty')}</p>;
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      {SIDES.map((side) => (
        <SideGroup
          key={side}
          side={side}
          entries={entries.filter((entry) => entry.item.side === side)}
          standings={standings}
          now={now}
        />
      ))}
    </div>
  );
}
