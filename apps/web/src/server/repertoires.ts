// A Player's repertoires as the pages and actions reach them (S3). Access is
// decided in the domain (canViewRepertoire, canEditRepertoire) and enforced
// again by the queries, which filter by owner (CLAUDE.md, decision 12).
import {
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
  REPERTOIRE_REFUSALS,
  type Account,
  type AccountRef,
  type Repertoire,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import type { RepertoireGraph } from '@mychess/chess';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import type { ChapterNames } from '../lib/chapter-label';
import { chapterNamesOf } from './chapter-names';
import { getDb } from './db';
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

/** Mano repertuarai: the session account's own repertoires. */
export async function myRepertoires(): Promise<RepertoireListItem[]> {
  const account = await requireOnboarded();
  return listRepertoires(getDb(), account.id);
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

/** What the repertoire page shows. */
export interface RepertoirePageData {
  readonly repertoire: Repertoire;
  readonly graph: RepertoireGraph;
  /** The viewer's own Personal notes on it, by move key (R-21). */
  readonly notes: Readonly<Record<string, string>>;
  /** What titles its chapters: opening names and distinctions (R-158). */
  readonly names: ChapterNames;
  readonly sharing: RepertoireSharing;
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

/** One repertoire's page; anything the account may not view is 404. */
export async function repertoirePageData(
  rawId: unknown,
): Promise<RepertoirePageData> {
  const account = await requireOnboarded();
  const own = await ownRepertoire(account, rawId, 'view');
  if (!own.ok) notFound();
  const { repertoire, graph } = own.value;
  return {
    repertoire,
    graph,
    notes: await listPersonalNotes(getDb(), account.id, repertoire.id),
    names: chapterNamesOf(graph, account.locale),
    sharing: await sharingOf(account.id, repertoire.id),
    coachNotes: await ownerCoachNotes(account.id, repertoire.id),
    forkNotes: await forkCoachNotesOn(getDb(), account.id, repertoire.id),
  };
}
