'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { AssignPanelData } from '../../../server/coach-assignments';
import { AssigneeRows } from './assignee-rows';
import { AssignNew } from './assign-new';
import { SECTION_LOOK, type SectionLook } from '../section-look';

/**
 * "Assigned to" on the coach's own repertoire (R-15, R-16, R-51, R-130,
 * R-225): a row per assignment (a player's with their progress, a group's
 * with its members' progress under it), the deadline to change or clear,
 * and Unassign; under the rows, the form that assigns it to a linked
 * player or group with an optional deadline. Shown only in Coach mode.
 */
export function AssignPanel({
  repertoireId,
  data,
  look = 'panel',
}: {
  readonly repertoireId: string;
  readonly data: AssignPanelData;
  readonly look?: SectionLook;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const titleId = useId();
  const { section, title, subtitle } = SECTION_LOOK[look];
  return (
    <section aria-labelledby={titleId} className={section}>
      <h2 id={titleId} className={title}>
        {t('list')}
      </h2>
      <AssigneeRows
        assignments={data.assignments}
        standings={data.standings}
        today={data.today}
      />
      <div className="flex flex-col gap-2">
        <h3 className={`${subtitle} mt-2`}>{t('title')}</h3>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
        <AssignNew repertoireId={repertoireId} data={data} />
      </div>
    </section>
  );
}
