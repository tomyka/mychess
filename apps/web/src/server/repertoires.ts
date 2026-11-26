import 'server-only';
// A Player's repertoires as the pages and actions reach them (S3). Access is
// decided in the domain (canViewRepertoire, canEditRepertoire) and enforced
// again by the queries, which filter by owner (CLAUDE.md, decision 12), or
// by the player's live assignment (R-202).
import {
  assignedPlayerCount,
  assignedRepertoireForPlayer,
  coachNotesOn,
  forkCoachNotesOn,
  listPersonalNotes,
  listRepertoires,
  loadRepertoire,
  playerCoaches,
  sharedCoachIds,
  type CoachNote,
  type ForkCoachNote,
  type LoadedRepertoire,
  type RepertoireListItem,
} from '@mychess/db';
import {
  canEditRepertoire,
  canViewRepertoire,
  isCoach,
  REPERTOIRE_REFUSALS,
  type Account,
  type AccountRef,
  type Repertoire,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import type { RepertoireGraph, Side } from '@mychess/chess';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';
import { getDb } from './db';
import {
  versionedRepertoireForViewer,
  type VersionedRepertoireForViewer,
} from './repertoire-for-viewer';
import { requireOnboarded } from './session';

type Own = Result<LoadedRepertoire, RepertoireAccessRefusal>;

const NOT_FOUND: Own = {
  ok: false,
  refusal: { reason: REPERTOIRE_REFUSALS.notFound },
};

/**
 * The repertoire `id` if `account` may view (or edit) it: the id is parsed,
 * the query filters by owner, and the domain rule decides. A missing and a
 * foreign repertoire read the same (decision 12).
 */
export async function ownRepertoire(
  account: Account,
  id: unknown,
  purpose: 'view' | 'edit',
): Promise<Own> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return NOT_FOUND;
  const loaded = await loadRepertoire(getDb(), parsed.data, account.id);
  if (loaded === undefined) return NOT_FOUND;
  const rule = purpose === 'edit' ? canEditRepertoire : canViewRepertoire;
  const allowed = rule(account, loaded.repertoire);
  return allowed.ok ? { ok: true, value: loaded } : allowed;
}

/** A repertoire as its PGN download needs it. */
export interface DownloadableRepertoire {
  readonly name: string;
  /** With its comments: the owner's, or the coach's on an assignment. */
  readonly graph: RepertoireGraph;
}

/**
 * Repertoire `id` if `account` may download it: its own (R-96, through
 * ownRepertoire), or one assigned to it now and not forked (R-202, through
 * the player's assigned read). Anything else, a repertoire only shared with
 * the account included, is undefined (decision 12).
 */
export async function downloadableRepertoire(
  account: Account,
  id: unknown,
): Promise<DownloadableRepertoire | undefined> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return undefined;
  const own = await ownRepertoire(account, parsed.data, 'view');
  if (own.ok)
    return { name: own.value.repertoire.name, graph: own.value.graph };
  const assigned = await assignedRepertoireForPlayer(
    getDb(),
    account.id,
    parsed.data,
    new Date(),
  );
  return assigned === undefined
    ? undefined
    : { name: assigned.repertoire.name, graph: assigned.graph };
}

/**
 * One of the account's repertoires as My repertoires shows it: a Fork
 * carries only the name of the coach it came from (R-135, #328), never the
 * coach's repertoire id.
 */
export type MyRepertoire = Omit<RepertoireListItem, 'forkedFrom'> & {
  readonly forkCoachName: string | null;
  /** How many players have it live from the coach (R-225); 0 for a non-coach. */
  readonly assignedTo: number;
};

/**
 * How many players have each of `items` assigned, in order: read only for
 * a coach, filtered by the session coach in the query.
 */
function assignedCounts(
  account: Account,
  items: readonly RepertoireListItem[],
): Promise<number[]> {
  if (!isCoach(account)) return Promise.resolve(items.map(() => 0));
  return Promise.all(
    items.map((item) => assignedPlayerCount(getDb(), account.id, item.id)),
  );
}

/** One of the account's own repertoires a PGN import can add to. */
export interface ImportTarget {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

/**
 * The session account's own repertoires as the import offers them: no
 * counts, so no assignee count is read for a coach.
 */
export async function importTargets(): Promise<ImportTarget[]> {
  const account = await requireOnboarded();
  const items = await listRepertoires(getDb(), account.id);
  return items.map(({ id, name, side }) => ({ id, name, side }));
}

/** My repertoires: the session account's own repertoires. */
export async function myRepertoires(): Promise<MyRepertoire[]> {
  const account = await requireOnboarded();
  const items = await listRepertoires(getDb(), account.id);
  const counts = await assignedCounts(account, items);
  return items.map(({ forkedFrom, ...item }, index) => ({
    ...item,
    forkCoachName: forkedFrom?.coachName ?? null,
    assignedTo: counts[index] ?? 0,
  }));
}

/**
 * The owner's linked coaches (those it can be shared with), and which of
 * them it is shared with (R-42).
 */
export interface RepertoireSharing {
  readonly coaches: readonly AccountRef[];
  readonly sharedWith: readonly string[];
}

/** A Coach note as the owner reads it: on a move, with the coach's name (R-107). */
export type OwnerCoachNote = Omit<CoachNote, 'updatedAt'>;

/** A note a fork kept from the coach who assigned it, with their name (R-47). */
export type ForkNote = ForkCoachNote;

/**
 * What the repertoire page shows: the repertoire as its owner sees it,
 * their Personal notes as its notes (R-21), and the coaches' notes.
 */
export interface RepertoirePageData extends VersionedRepertoireForViewer {
  /** Every coach's notes on it, read-only (R-107, R-125). */
  readonly coachNotes: readonly OwnerCoachNote[];
  /**
   * On the owner's fork of an assignment, the coach's notes it kept,
   * read-only (R-43, R-49); none on any other repertoire.
   */
  readonly forkNotes: readonly ForkNote[];
}

/** The owner's coaches and shares of repertoire `id`. */
async function sharingOf(
  ownerId: string,
  id: string,
): Promise<RepertoireSharing> {
  const db = getDb();
  const coaches = await playerCoaches(db, ownerId);
  return {
    coaches: coaches.map((coach) => ({
      id: coach.id,
      displayName: coach.displayName,
    })),
    sharedWith: await sharedCoachIds(db, ownerId, id),
  };
}

/** The coach notes on the owner's repertoire `id`, as the page shows them. */
async function ownerCoachNotes(
  ownerId: string,
  id: string,
): Promise<OwnerCoachNote[]> {
  const notes = await coachNotesOn(getDb(), ownerId, id);
  return notes.map(({ coachId, coachName, moveKey, text }) => ({
    coachId,
    coachName,
    moveKey,
    text,
  }));
}

/**
 * Repertoire `rawId` as the session account views it, read once per
 * request (the page's layout and the page share it); anything the account
 * may not view is 404.
 */
export const viewedRepertoire = cache(
  async (
    rawId: unknown,
  ): Promise<{ account: Account; loaded: LoadedRepertoire }> => {
    const account = await requireOnboarded();
    const own = await ownRepertoire(account, rawId, 'view');
    if (!own.ok) notFound();
    return { account, loaded: own.value };
  },
);

/** What the Repertoire screen of an own repertoire shows (R-226). */
export interface RepertoireManageData {
  readonly repertoire: Pick<Repertoire, 'id' | 'name'>;
  readonly sharing: RepertoireSharing;
}

/**
 * One own repertoire's Repertoire screen: its id and name and its
 * sharing, no more (its layout's read, shared through the request cache;
 * no notes). Anything the account may not view is 404, one only assigned
 * to it included (that one's screen is under /assigned).
 */
export async function repertoireManageData(
  rawId: unknown,
): Promise<RepertoireManageData> {
  const { account, loaded } = await viewedRepertoire(rawId);
  const { id, name } = loaded.repertoire;
  return { repertoire: { id, name }, sharing: await sharingOf(account.id, id) };
}

/** One repertoire's page; anything the account may not view is 404. */
export async function repertoirePageData(
  rawId: unknown,
): Promise<RepertoirePageData> {
  const { account, loaded } = await viewedRepertoire(rawId);
  const { id } = loaded.repertoire;
  const db = getDb();
  return {
    ...versionedRepertoireForViewer(
      loaded,
      await listPersonalNotes(db, account.id, id),
    ),
    coachNotes: await ownerCoachNotes(account.id, id),
    forkNotes: await forkCoachNotesOn(db, account.id, id),
  };
}
