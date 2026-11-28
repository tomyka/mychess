import { FOUND_GAMES_LIMIT } from '@mychess/db';
import type { JSX } from 'react';
import { requireOnboarded } from '../../server/session';
import { CONTENT } from '../surfaces';
import { FideHeader } from './fide-header';
import { FideSearch } from './fide-search';

/**
 * The FIDE ID search (#316): any signed-in account (R-186) lists a
 * player's Lichess broadcast games of the last 12 months, to prepare for
 * them (R-171). Next serves it with `Referrer-Policy: no-referrer` (next.config.ts).
 */
export default async function FidePage(): Promise<JSX.Element> {
  await requireOnboarded();
  return (
    <main className={`${CONTENT} gap-6`}>
      <FideHeader />
      <FideSearch truncatedLimit={FOUND_GAMES_LIMIT} />
    </main>
  );
}
