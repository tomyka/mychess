import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { BRAND } from '../lib/brand';
import { ROUTES } from '../lib/routes';

/**
 * The frame of the screens before the app (#381 part 6): sign-in, welcome
 * and the invite page. The wordmark in `fg`, as the top bar has it, over
 * one soft card; `below` goes under the card (welcome's delete link). Top
 * aligned on a phone; from md the column starts a fixed share of the
 * screen down rather than being centred, so content opening in the card
 * never moves it (finding 23).
 */
export function EntryFrame({
  children,
  below,
}: {
  readonly children: ReactNode;
  readonly below?: ReactNode;
}): JSX.Element {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-gutter pt-6 pb-8 sm:px-gutter-wide md:pt-[18vh]">
      <header>
        <Link
          href={ROUTES.home}
          className="text-lg font-bold tracking-tight text-fg"
        >
          {BRAND}
        </Link>
      </header>
      <main className="flex flex-col gap-4">
        <div className="flex flex-col gap-6 rounded-card border border-card-edge bg-surface p-8 shadow-card">
          {children}
        </div>
        {below === undefined ? null : <div>{below}</div>}
      </main>
    </div>
  );
}
