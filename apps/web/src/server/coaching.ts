import {
  canCoachSee,
  isCoach,
  type Account,
  type CoachAccessFacts,
  type CoachSubject,
} from '@mychess/domain';
import { notFound, redirect } from 'next/navigation';
import { ROUTES } from '../lib/routes';
import { requireOnboarded } from './session';

/**
 * The session account with Coach mode on; an account without it goes to
 * settings, where the switch is (plan decision 11).
 */
export async function requireCoach(): Promise<Account> {
  const account = await requireOnboarded();
  if (!isCoach(account)) redirect(ROUTES.settings);
  return account;
}

/**
 * The access decision (checklist 1-3) on facts the caller read on this
 * request, in one snapshot with the data they guard: a refusal is a plain
 * 404 (plan decision 4). The query that read the data joined coach_links
 * again.
 */
export function assertCoachMaySeeBy(
  coach: Account,
  playerId: string,
  subject: CoachSubject,
  facts: CoachAccessFacts,
): void {
  if (!canCoachSee(coach.id, playerId, subject, facts).ok) notFound();
}
