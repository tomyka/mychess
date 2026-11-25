// The tab icons: 24px line icons in currentColor, decorative (the label
// names the tab).
import type { JSX } from 'react';
import type { TabId } from './nav-tabs';

const PATHS: Record<TabId, string> = {
  // a calendar day
  today:
    'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4',
  // an open book
  repertoires:
    'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5m0-13c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5m0-13v13',
  // two people
  opponents:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6m1-9a3 3 0 1 0 0-6m2 15c0-2.6-1.6-4.8-4-5.6',
  // a person at a table
  coach:
    'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 10c0-3.9 3.1-7 7-7s7 3.1 7 7M4 20h16',
};

export function NavIcon({ tab }: { readonly tab: TabId }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[tab]} />
    </svg>
  );
}
