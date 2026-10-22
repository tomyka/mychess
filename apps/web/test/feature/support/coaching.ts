// Coaching set-up for feature tests: Coach mode, groups and links made
// straight through the repositories, so a test drives only the action or
// loader it is about.
import {
  acceptInvite,
  createGroup,
  createInvite,
  startCoaching,
} from '@mychess/db';
import { cookieFrom, mailedLink, onboard, requestMagicLink } from './auth';
import { built, request, testDb } from './request';
import type { SqlHelpers } from './rows';

/** A signed-in, onboarded account: its id and its session cookie. */
export interface Person {
  readonly id: string;
  readonly cookie: string;
}

let people = 0;

/**
 * The address the next person signs in from: one each, so a test with
 * several people stays under the magic-link limit of 3 a minute per
 * address (src/server/auth.ts).
 */
function nextAddress(): string {
  people += 1;
  return `198.51.100.${String((people % 250) + 1)}`;
}

/** Signs `email` in by magic link from its own address; the cookie. */
async function signInAlone(email: string): Promise<string> {
  await requestMagicLink(
    built(),
    { email, callbackURL: '/' },
    { 'x-real-ip': nextAddress() },
  );
  const link = mailedLink(built());
  if (link === undefined) throw new Error('no magic link was mailed');
  return cookieFrom(await built().auth.handler(new Request(link)));
}

/** Onboards `email` as `displayName`, and returns its id and cookie. */
export async function person(
  sql: SqlHelpers,
  email: string,
  displayName: string,
): Promise<Person> {
  const cookie = await signInAlone(email);
  await onboard(built(), testDb(), cookie, { displayName, locale: 'lt' });
  return { id: await sql.accountId(email), cookie };
}

/** Onboards `email` with Coach mode on. */
export async function coachPerson(
  sql: SqlHelpers,
  email: string,
  displayName: string,
): Promise<Person> {
  const made = await person(sql, email, displayName);
  await startCoaching(testDb(), made.id, new Date());
  return made;
}

/** Makes a group of `coachId`; returns its id. */
export async function groupOf(coachId: string, name: string): Promise<string> {
  const made = await createGroup(testDb(), coachId, name, new Date());
  if (!made.ok) throw new Error(`no group: ${made.refusal.reason}`);
  return made.value;
}

/** Links `playerId` to `coachId` through a personal invite, into `groupId`. */
export async function link(
  coachId: string,
  playerId: string,
  groupId: string | null = null,
): Promise<void> {
  const now = new Date();
  const made = await createInvite(testDb(), {
    coachId,
    kind: 'personal',
    groupId,
    now,
  });
  if (!made.ok) throw new Error(`no invite: ${made.refusal.reason}`);
  const accepted = await acceptInvite(
    testDb(),
    made.value.token,
    playerId,
    now,
  );
  if (!accepted.ok) throw new Error(`not linked: ${accepted.refusal.reason}`);
}

/** Acts as `who` from here on. */
export function actAs(who: Person): void {
  request.cookie = who.cookie;
}

/** A form with these fields. */
export function formOf(fields: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
