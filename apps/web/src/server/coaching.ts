import { coachAccessFacts } from '@mychess/db';
import {
  canCoachSee,
  isCoach,
  type Account,
  type CoachSubject,
} from '@mychess/domain';
import { notFound, redirect } from 'next/navigation';
import { ROUTES } from '../lib/routes';
import { getDb } from './db';
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
 * Every coach-facing read of a player starts here (checklist 1-3): the
 * facts are read on this request, the domain decides, and a refusal is a
 * plain 404 (plan decision 4). The query that follows joins coach_links
 * again.
 */
export async function assertCoachMaySee(
  coach: Account,
  playerId: string,
  subject: CoachSubject,
): Promise<void> {
  const facts = await coachAccessFacts(getDb(), coach.id, playerId);
  if (!canCoachSee(coach.id, playerId, subject, facts).ok) notFound();
}
