'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { AssignPanelData } from '../../../server/coach-assignments';
import { AssigneeRows } from './assignee-rows';
import { AssignNew } from './assign-new';
import { SECTION, SECTION_TITLE } from '../../settings/styles';

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
}: {
  readonly repertoireId: string;
  readonly data: AssignPanelData;
}): JSX.Element {
  const t = useTranslations('assignment.panel');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('list')}
      </h2>
      <AssigneeRows
        assignments={data.assignments}
        standings={data.standings}
        today={data.today}
      />
      <div className="flex flex-col gap-2">
        <h3 className="mt-2 text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-fg-muted">{t('intro')}</p>
        <AssignNew repertoireId={repertoireId} data={data} />
      </div>
    </section>
  );
}
