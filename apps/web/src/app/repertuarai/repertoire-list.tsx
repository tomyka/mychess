import type { Side } from '@mychess/chess';
import {
  useFormatter,
  useLocale,
  useTranslations,
  type DateTimeFormatOptions,
} from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { DISPLAY_TIME_ZONE } from '../../lib/time-zone';
import { repertoireRoute } from '../../lib/routes';

/** One repertoire as Mano repertuarai lists it. */
export interface RepertoireCard {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  readonly chapters: number;
  readonly moves: number;
  readonly updatedAt: Date;
}

const SIDES: readonly Side[] = ['white', 'black'];

/** The calendar day of `date` in the display time zone, as `YYYY-MM-DD`. */
const dayOf = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIME_ZONE });

/**
 * How "Changed" shows a time (docs/design/repertoire-screen.md): today as a
 * time, this year as day and month, older with the year.
 */
function changedFormat(updatedAt: Date, now: Date): DateTimeFormatOptions {
  if (dayOf(updatedAt) === dayOf(now))
    return { hour: '2-digit', minute: '2-digit' };
  const sameYear = dayOf(updatedAt).slice(0, 4) === dayOf(now).slice(0, 4);
  return sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
}

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
  const changed = format.dateTime(item.updatedAt, {
    ...changedFormat(item.updatedAt, now),
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <Link
      href={repertoireRoute(item.id)}
      aria-labelledby={nameId}
      aria-describedby={metaId}
      title={item.name}
      className="flex min-h-touch flex-col gap-1 rounded-card border border-border bg-surface p-4"
    >
      <span id={nameId} className="line-clamp-2 text-lg font-semibold">
        {item.name}
      </span>
      <span id={metaId} className="flex flex-col text-sm text-fg-muted">
        <span>{t('meta', { chapters: item.chapters, moves: item.moves })}</span>
        <span>{t('changed', { date: changed })}</span>
      </span>
    </Link>
  );
}

const EMPTY_KEY = { white: 'emptyWhite', black: 'emptyBlack' } as const;

function SideGroup({
  side,
  items,
  now,
}: {
  readonly side: Side;
  readonly items: readonly RepertoireCard[];
  readonly now: Date;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="text-lg font-semibold">
        {t(side)}
      </h2>
      {items.length === 0 ? (
        <p className="text-fg-muted">{t(EMPTY_KEY[side])}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card item={item} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The account's repertoires by side, White then Black, each sorted by name
 * in the account's language; one line when there are none at all.
 */
export function RepertoireList({
  items,
  now,
}: {
  readonly items: readonly RepertoireCard[];
  readonly now: Date;
}): JSX.Element {
  const t = useTranslations('repertoires.list');
  const collator = new Intl.Collator(useLocale());
  if (items.length === 0) return <p className="text-fg-muted">{t('empty')}</p>;
  const sorted = [...items].sort((a, b) => collator.compare(a.name, b.name));
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      {SIDES.map((side) => (
        <SideGroup
          key={side}
          side={side}
          items={sorted.filter((item) => item.side === side)}
          now={now}
        />
      ))}
    </div>
  );
}
