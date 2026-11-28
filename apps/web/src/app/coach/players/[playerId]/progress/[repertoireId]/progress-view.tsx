import {
  isUnstarted,
  lineTextsFromTrunk,
  percentLearned,
  type Standing,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import {
  coachPlayerPath,
  coachSharedRepertoirePath,
  repertoireRoute,
} from '../../../../../../lib/routes';
import type {
  ChapterRow,
  ProgressPage,
} from '../../../../../../server/coach-progress';
import { SECONDARY_BUTTON } from '../../../../../buttons';
import { MasteredBadge } from '../../../../../mastered-badge';
import { Pill } from '../../../../../pill';
import { SECTION, SECTION_TITLE } from '../../../../../settings/styles';
import {
  AssignmentStatusLine,
  liveStatus,
} from '../../../../assignment-status-line';
import { useOwnCopyTitle } from '../../../../own-copy-title';
import { ProgressCounts } from '../../../../progress-counts';
import { StateBar } from '../../../../state-bar';
import { COACH_PAGE, SubpageHeader } from '../../../../subpage-header';

/**
 * A line's state on its right: "N due", else "Not started", else
 * Mastered, else "N% learned".
 */
function LineState({ counts, mastered }: Standing): JSX.Element | null {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(counts);
  if (counts.due > 0)
    return (
      <span className="text-due">{t('part.due', { count: counts.due })}</span>
    );
  if (isUnstarted(counts)) return <span>{t('lineNotStarted')}</span>;
  if (mastered) return <MasteredBadge />;
  return percent === null ? null : <span>{t('percent', { percent })}</span>;
}

/** A chapter's lines, each from where it leaves the trunk, its state on the right. */
function Lines({ chapter }: { readonly chapter: ChapterRow }): JSX.Element {
  const t = useTranslations('coach.progress');
  const texts = lineTextsFromTrunk(
    chapter.lines.map((line) => line.sans),
    chapter.whiteFirst,
  );
  return (
    <ul
      aria-label={t('lines')}
      className="flex flex-col divide-y divide-border pt-2 pl-4"
    >
      {chapter.lines.map((line, index) => (
        <li
          key={line.sans.join(' ')}
          className="flex items-start justify-between gap-3 py-2"
        >
          <span className="min-w-0 text-sm break-words">{texts[index]}</span>
          <span className="shrink-0 text-sm text-fg-muted">
            <LineState counts={line.counts} mastered={line.mastered} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A chapter summed up: the Mastered pill alone when mastered, else "Not
 * started · N moves", or "% learned" with the due count when above zero.
 */
function ChapterState({ counts, mastered }: Standing): JSX.Element | null {
  const t = useTranslations('coach.progress');
  const percent = percentLearned(counts);
  if (percent === null) return null;
  if (mastered) return <MasteredBadge />;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
      {isUnstarted(counts) ? (
        <span>{t('notStarted', { count: counts.notStarted })}</span>
      ) : (
        <span>
          {t('percent', { percent })}
          {counts.due > 0 ? (
            <>
              {t('separator')}
              <span className="text-due">
                {t('part.due', { count: counts.due })}
              </span>
            </>
          ) : null}
        </span>
      )}
    </p>
  );
}

/**
 * A chapter as a disclosure, closed at first: its full title (R-158), bar
 * and state, opening to its lines. One with no line (no own move) is a
 * plain row, with nothing to open.
 */
function Chapter({ chapter }: { readonly chapter: ChapterRow }): JSX.Element {
  const bar = (
    <>
      <StateBar counts={chapter.counts} size="row" />
      <ChapterState counts={chapter.counts} mastered={chapter.mastered} />
    </>
  );
  if (chapter.lines.length === 0) {
    return (
      <li className="flex min-h-touch flex-col justify-center gap-1">
        <span className="font-semibold break-words">{chapter.title}</span>
        {bar}
      </li>
    );
  }
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-touch cursor-pointer flex-col justify-center gap-1">
          <span className="flex items-center justify-between gap-3 font-semibold break-words after:mr-1 after:size-2 after:shrink-0 after:rotate-45 after:border-r-2 after:border-b-2 after:border-fg-muted after:transition-transform after:content-[''] group-open:after:-rotate-135">
            {chapter.title}
          </span>
          {bar}
        </summary>
        <Lines chapter={chapter} />
      </details>
    </li>
  );
}

/** The page's title: the repertoire, or whose own copy of it (R-155). */
function useTitle(page: ProgressPage): string {
  return useOwnCopyTitle({
    isFork: page.tag === 'fork',
    playerName: page.player.displayName,
    repertoireName: page.repertoire.name,
  });
}

/**
 * Where the coach opens the repertoire: their own, for an assignment; the
 * player's shared one, to add notes, otherwise (a fork is shared too).
 */
function OpenLink({ page }: { readonly page: ProgressPage }): JSX.Element {
  const t = useTranslations('coach.progress');
  const assigned = page.tag === 'assigned';
  return (
    <Link
      href={
        assigned
          ? repertoireRoute(page.repertoire.id)
          : coachSharedRepertoirePath(page.player.id, page.repertoire.id)
      }
      className={`${SECONDARY_BUTTON} self-start`}
    >
      {assigned ? t('openRepertoire') : t('openShared')}
    </Link>
  );
}

/**
 * Under the title: the player and the tag (a fork's is "Own copy": the
 * title already names whose, R-155), the status, the bar and counts.
 */
function HeaderFacts({ page }: { readonly page: ProgressPage }): JSX.Element {
  const tags = useTranslations('coach.progress.tag');
  const tag = tags(page.tag);
  const status = liveStatus(page.status);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-muted">
        <span className="break-words">{page.player.displayName}</span>
        <Pill tone="neutral">{tag}</Pill>
      </p>
      {status === null ? null : (
        <AssignmentStatusLine
          status={status}
          today={page.today}
          wording="due"
        />
      )}
      <StateBar counts={page.standing.counts} size="header" />
      <ProgressCounts
        counts={page.standing.counts}
        mastered={page.standing.mastered}
      />
      <OpenLink page={page} />
    </div>
  );
}

/** One player's progress on one repertoire, chapter by chapter, line by line. */
export function ProgressView({
  page,
}: {
  readonly page: ProgressPage;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const chaptersId = useId();
  return (
    <main className={COACH_PAGE}>
      <SubpageHeader
        title={useTitle(page)}
        back={{
          href: coachPlayerPath(page.player.id),
          parent: page.player.displayName,
        }}
      >
        <HeaderFacts page={page} />
      </SubpageHeader>
      <section aria-labelledby={chaptersId} className={SECTION}>
        <h2 id={chaptersId} className={SECTION_TITLE}>
          {t('chapters')}
        </h2>
        <ul className="flex flex-col gap-4">
          {page.chapters.map((chapter) => (
            <Chapter key={chapter.id} chapter={chapter} />
          ))}
        </ul>
      </section>
    </main>
  );
}
