'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type JSX, type ReactNode } from 'react';
import { assignedRepertoirePath } from '../../../../../lib/routes';
import { PageHeader } from '../../../../shell/page-header';
import { CONTENT } from '../../../../surfaces';
import type { Repertoire } from '../../../[id]/repertoire-types';
import { DownloadLink } from '../../../download-link';
import { SECTION_LOOK } from '../../../section-look';

const CARD = SECTION_LOOK.card;
import { ForkCopy, type ForkAction } from '../fork-copy';
import { PauseControl, usePause } from '../pause-control';

/** One card: its title, the one muted line saying what it does, the control. */
function ActionSection({
  title,
  intro,
  children,
}: {
  readonly title: string;
  readonly intro: string;
  readonly children: ReactNode;
}): JSX.Element {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={CARD.section}>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className={CARD.title}>
          {title}
        </h2>
        <p className="text-fg-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * The Repertoire screen of a repertoire the player has from their coach
 * (R-226): pause or resume it (R-46), download its PGN (R-202), and make
 * their own copy (R-20, R-43), each with what it does. `forkOpen` starts
 * with the copy's question asked (`?fork=1`).
 */
export function AssignedManage({
  repertoire,
  paused,
  forkAction,
  forkOpen,
}: {
  readonly repertoire: Repertoire;
  /** Whether the assignment was paused as the page loaded. */
  readonly paused: boolean;
  readonly forkAction: ForkAction;
  readonly forkOpen: boolean;
}): JSX.Element {
  const t = useTranslations();
  const pause = usePause(paused);
  const [asking, setAsking] = useState(forkOpen);
  const { id, name } = repertoire;
  return (
    <main className={`${CONTENT} gap-8`}>
      <PageHeader
        back={{ href: assignedRepertoirePath(id), parent: name }}
        title={name}
      />
      <ActionSection
        title={t(
          pause.state.paused
            ? 'assignment.pause.resume'
            : 'assignment.pause.pause',
        )}
        intro={t('assignment.manage.pauseIntro')}
      >
        <PauseControl repertoireId={id} pause={pause} />
      </ActionSection>
      <ActionSection
        title={t('repertoires.header.download')}
        intro={t('assignment.manage.downloadIntro')}
      >
        <DownloadLink id={id} />
      </ActionSection>
      <ActionSection
        title={t('assignment.fork.label')}
        intro={t('assignment.manage.forkIntro')}
      >
        <ForkCopy
          repertoireId={id}
          name={name}
          action={forkAction}
          asking={{ open: asking, set: setAsking }}
        />
      </ActionSection>
    </main>
  );
}
