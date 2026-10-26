'use client';

import {
  twoAnswers,
  type QueueItem,
  type RepertoireGraph,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** A repertoire the player trains, by name. */
export interface NamedRepertoire {
  readonly id: string;
  readonly name: string;
  readonly graph: RepertoireGraph;
}

export interface TwoAnswersNoticeProps {
  /** The asked item: its position and its repertoire's move. */
  readonly item: QueueItem;
  /** Every repertoire the player trains, in the session or not. */
  readonly repertoires: readonly NamedRepertoire[];
}

/**
 * R-54: the player's other repertoires that play another move in the asked
 * position, each by name with its move. It only informs: the item still
 * expects its own repertoire's move, and nothing waits on the notice.
 */
export function TwoAnswersNotice({
  item,
  repertoires,
}: TwoAnswersNoticeProps): JSX.Element | null {
  const t = useTranslations('training.review.twoAnswers');
  const others = twoAnswers(item.fromKey, item.san, repertoires).filter(
    (a) => a.repertoireId !== item.repertoireId,
  );
  if (others.length === 0) return null;
  const nameOf = (id: string): string =>
    repertoires.find((r) => r.id === id)?.name ?? '';
  return (
    <div
      role="note"
      className="rounded-control bg-sunken px-3 py-2 text-sm text-fg-muted"
    >
      <p>{t('title')}</p>
      <ul className="list-inside list-disc">
        {others.map((a) => (
          <li key={a.repertoireId}>
            {t('item', { name: nameOf(a.repertoireId), move: a.san })}
          </li>
        ))}
      </ul>
    </div>
  );
}
