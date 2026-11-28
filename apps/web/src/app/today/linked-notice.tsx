'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';
import type { LinkedFact } from '../../server/today-page';
import { QUIET_ACTION } from '../buttons';
import { StatusLine } from '../status-line';

/** The params accepting an invite lands on Today with (R-234). */
const LINKED_PARAMS = ['linked', 'group'] as const;

/**
 * Once the notice has shown, takes `names` out of the address and keeps the
 * rest, so a reload does not say it again. Through the History API, which
 * Next.js keeps its router in step with: a router replace would load the
 * page again without the params, and the notice would go before the player
 * read it.
 */
function useDropParams(names: readonly string[]): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const name of names) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', url);
  }, [names]);
}

/**
 * Today's one-time "linked with" line after accepting an invite (R-234):
 * the coach and, for a group invite, the group, as `todayPage` found them
 * among the player's own links. Dismiss hides it.
 */
export function LinkedNotice({
  linked,
}: {
  readonly linked: LinkedFact;
}): JSX.Element | null {
  const t = useTranslations('today');
  const [shown, setShown] = useState(true);
  useDropParams(LINKED_PARAMS);
  if (!shown) return null;
  const text =
    linked.groupName === null
      ? t('linked', { coach: linked.coachName })
      : t('linkedThrough', {
          coach: linked.coachName,
          group: linked.groupName,
        });
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <StatusLine text={text} tone="success" />
      </div>
      <button
        type="button"
        className={QUIET_ACTION}
        onClick={() => {
          setShown(false);
        }}
      >
        {t('dismiss')}
      </button>
    </div>
  );
}
