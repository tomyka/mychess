'use client';

import { useTranslations } from 'next-intl';
import { useId, type JSX } from 'react';
import type { AssignPanelData } from '../../../server/coach-assignments';
import { PANEL_LABEL } from '../../repertoire-view';
import { AssignNew } from './assign-new';
import { AssignmentRow } from './assignment-row';

/**
 * "Assign" on the coach's own repertoire (R-15, R-16, R-51, R-130): pick a
 * linked player or group with an optional deadline; under it, whom it is
 * assigned to, with each player's badges, the deadline to change or clear,
 * and Unassign. The page shows it only in Coach mode.
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
  const listId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className={PANEL_LABEL}>
        {t('title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('intro')}</p>
      <AssignNew repertoireId={repertoireId} data={data} />
      <h3 id={listId} className={`${PANEL_LABEL} mt-4`}>
        {t('list')}
      </h3>
      {data.assignments.length === 0 ? (
        <p className="text-fg-muted">{t('none')}</p>
      ) : (
        <ul aria-labelledby={listId} className="flex flex-col gap-3">
          {data.assignments.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} />
          ))}
        </ul>
      )}
    </section>
  );
}
