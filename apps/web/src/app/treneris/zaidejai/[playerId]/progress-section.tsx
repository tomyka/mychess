import type { ProgressCounts } from '@mychess/chess';
import type { ProgressRow } from '@mychess/db';
import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachProgressPath } from '../../../../lib/routes';
import type { PlayerProgressSection } from '../../../../server/coach-progress';
import { AssignmentBadges } from '../../../assignment-badges';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../../../nustatymai/styles';
import { LastTrained } from '../../last-trained';
import { StateBar, usePercentLearned } from '../../state-bar';

/** The repertoire's name: a link to its progress page, or plain when forked (R-155). */
function RowName({
  playerId,
  row,
}: {
  readonly playerId: string;
  readonly row: ProgressRow;
}): JSX.Element {
  const { repertoire } = row;
  if (row.standing === null) {
    return <span className="font-semibold">{repertoire.name}</span>;
  }
  return (
    <Link
      href={coachProgressPath(playerId, repertoire.id)}
      className={`${TEXT_LINK} font-semibold`}
    >
      {repertoire.name}
    </Link>
  );
}

/**
 * " · 50 % išmokta" after the source; nothing when there is nothing to
 * learn, which the state bar under it says once.
 */
function Percent({
  counts,
}: {
  readonly counts: ProgressCounts;
}): JSX.Element | null {
  const percent = usePercentLearned(counts);
  return percent.empty ? null : <>{` · ${percent.text}`}</>;
}

/** One repertoire: name, assigned or shared with % learned, badges, the state bar. */
function Row({
  playerId,
  row,
}: {
  readonly playerId: string;
  readonly row: ProgressRow;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const { standing, badges } = row;
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-2">
        <RowName playerId={playerId} row={row} />
        <span className="text-sm text-fg-muted">
          {t(row.source)}
          {standing === null ? null : <Percent counts={standing.counts} />}
        </span>
      </div>
      {badges === null ? null : <AssignmentBadges flags={badges} />}
      {standing === null ? (
        <p className="text-sm text-fg-muted">{t('forkedNote')}</p>
      ) : (
        <StateBar counts={standing.counts} mastered={standing.mastered} />
      )}
    </li>
  );
}

/**
 * Every repertoire the coach may see progress on, and when the player last
 * trained (R-151 to R-155). Translations and useId only, so the client
 * PlayerView can render it; the loader module is imported for its type only.
 */
export function ProgressSection({
  player,
  progress,
}: {
  readonly player: AccountRef;
  readonly progress: PlayerProgressSection;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <LastTrained days={progress.lastTrainedDays} />
      {progress.rows.length === 0 ? (
        <p className="text-fg-muted">
          {t('empty', { name: player.displayName })}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {progress.rows.map((row) => (
            <Row key={row.repertoire.id} playerId={player.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
