import { SIDES, type Side } from '@mychess/chess';
import { byName, vilniusDay } from '@mychess/domain';
import {
  useFormatter,
  useTranslations,
  type DateTimeFormatOptions,
} from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { CLOCK, shortDateFormat } from '../../lib/date-format';
import { assignedRepertoirePath, repertoireRoute } from '../../lib/routes';
import type { AssignedListItem } from '../../server/assignment-pages';
import { AssignmentFacts } from '../assignment-facts';

/** A card on the list: the whole card is the link to its page. */
const CARD =
  'flex min-h-touch flex-col gap-1 rounded-card border border-border bg-surface p-4';

/** One repertoire as Mano repertuarai lists it. */
export interface RepertoireCard {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  readonly chapters: number;
  readonly moves: number;
  readonly updatedAt: Date;
  /** The coach whose assignment this is a Fork of (R-135, #328); null when it is none. */
  readonly forkCoachName: string | null;
}

/**
 * How "Changed" shows a time (docs/design/repertoire-screen.md): today as a
 * 24-hour time, this year as day and month, older with the year.
 */
const changedFormat = (updatedAt: Date, now: Date): DateTimeFormatOptions =>
  vilniusDay(updatedAt) === vilniusDay(now)
    ? CLOCK
    : shortDateFormat(updatedAt, now);

function Card({
  item,
  now,
}: {
  readonly item: RepertoireCard;
  readonly now: Date;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const format = useFormatter();
  const nameId = useId();
  const metaId = useId();
  const changed = format.dateTime(
    item.updatedAt,
    changedFormat(item.updatedAt, now),
  );
  return (
    <Link
      href={repertoireRoute(item.id)}
      aria-labelledby={nameId}
      aria-describedby={metaId}
      title={item.name}
      className={CARD}
    >
      <span id={nameId} className="line-clamp-2 text-lg font-semibold">
        {item.name}
      </span>
      <span id={metaId} className="flex flex-col text-sm text-fg-muted">
        {item.forkCoachName === null ? null : (
          <span>{t('forkOf', { coach: item.forkCoachName })}</span>
        )}
        <span>{t('meta', { chapters: item.chapters, moves: item.moves })}</span>
        <span>{t('changed', { date: changed })}</span>
      </span>
    </Link>
  );
}

const EMPTY_KEY = { white: 'emptyWhite', black: 'emptyBlack' } as const;

/**
 * The side's king beside its heading: the side's fill in both themes, an
 * outline that stands out from the page (tokens.css, piece glyphs).
 */
function King({ side }: { readonly side: Side }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-6 shrink-0 stroke-piece-outline ${side === 'white' ? 'fill-piece-white' : 'fill-piece-black'}`}
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M12 2.5v4M10 4.5h4" fill="none" />
      <path d="M12 8.5c-2-2.5-7-2-7 2.5 0 2.5 2 4 2 6.5h10c0-2.5 2-4 2-6.5 0-4.5-5-5-7-2.5z" />
      <path d="M6.5 17.5h11v3.5h-11z" />
    </svg>
  );
}

/**
 * A repertoire a coach assigned to the player: its page, who assigned it,
 * the deadline and the badges, as home's "From my coach" shows them.
 */
function AssignedCard({
  item,
}: {
  readonly item: AssignedListItem;
}): JSX.Element {
  const nameId = useId();
  const metaId = useId();
  return (
    <Link
      href={assignedRepertoirePath(item.repertoireId)}
      aria-labelledby={nameId}
      aria-describedby={metaId}
      title={item.name}
      className={CARD}
    >
      <span id={nameId} className="line-clamp-2 text-lg font-semibold">
        {item.name}
      </span>
      <AssignmentFacts
        assignment={item}
        id={metaId}
        className="text-sm text-fg-muted"
      />
    </Link>
  );
}

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
  now,
}: {
  readonly side: Side;
  readonly entries: readonly Entry[];
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
        <King side={side} />
        {t(side)}
      </h2>
      {entries.length === 0 ? (
        <p className="text-fg-muted">{t(EMPTY_KEY[side])}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={keyOf(entry)}>
              {entry.kind === 'own' ? (
                <Card item={entry.item} now={now} />
              ) : (
                <AssignedCard item={entry.item} />
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
 * then Black, each sorted by name in Lithuanian order whatever the viewer's
 * language (R-160); one line when there are none at all.
 */
export function RepertoireList({
  items,
  assigned,
  now,
}: {
  readonly items: readonly RepertoireCard[];
  readonly assigned: readonly AssignedListItem[];
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
          now={now}
        />
      ))}
    </div>
  );
}
