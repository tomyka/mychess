import { lineText } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath } from '../../../../../../lib/routes';
import type {
  ChapterRow,
  ProgressPage,
} from '../../../../../../server/coach-progress';
import { AssignmentBadges } from '../../../../../assignment-badges';
import {
  SECTION,
  SECTION_TITLE,
  TEXT_LINK,
} from '../../../../../nustatymai/styles';
import { StateBar } from '../../../../state-bar';
import { COACH_PAGE, SubpageHeader } from '../../../../subpage-header';

/** A chapter's lines, each with its own bar. */
function Lines({ chapter }: { readonly chapter: ChapterRow }): JSX.Element {
  const t = useTranslations('coach.progress');
  return (
    <ul aria-label={t('lines')} className="flex flex-col gap-3 pt-2 pl-4">
      {chapter.lines.map((line) => (
        <li key={line.sans.join(' ')} className="flex flex-col gap-1">
          <span className="text-sm break-words">
            {lineText(line.sans, chapter.whiteFirst)}
          </span>
          <StateBar counts={line.counts} mastered={line.mastered} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A chapter as a disclosure: its title and bar, opening to its lines. One
 * with no line (no own move) is a plain row, with nothing to open.
 */
function Chapter({ chapter }: { readonly chapter: ChapterRow }): JSX.Element {
  const bar = <StateBar counts={chapter.counts} mastered={chapter.mastered} />;
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
      <SubpageHeader title={page.repertoire.name}>
        <Link href={coachPlayerPath(page.player.id)} className={TEXT_LINK}>
          {page.player.displayName}
        </Link>
        {page.badges === null ? null : <AssignmentBadges flags={page.badges} />}
        <StateBar
          counts={page.standing.counts}
          mastered={page.standing.mastered}
        />
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
