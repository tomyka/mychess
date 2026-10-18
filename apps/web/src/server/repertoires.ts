// A Player's repertoires as the pages and actions reach them (S3). Access is
// decided in the domain (canViewRepertoire, canEditRepertoire) and enforced
// again by the queries, which filter by owner (CLAUDE.md, decision 12).
import {
  listPersonalNotes,
  listRepertoires,
  loadRepertoire,
  type LoadedRepertoire,
  type RepertoireListItem,
} from '@mychess/db';
import {
  canEditRepertoire,
  canViewRepertoire,
  REPERTOIRE_REFUSALS,
  type Account,
  type Repertoire,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import type { RepertoireGraph } from '@mychess/chess';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ecoNamesOf } from './chapter-names';
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

/** What the repertoire page shows. */
export interface RepertoirePageData {
  readonly repertoire: Repertoire;
  readonly graph: RepertoireGraph;
  /** The viewer's own Personal notes on it, by move key (R-21). */
  readonly notes: Readonly<Record<string, string>>;
  /** The names of the openings its chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
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
    ecoNames: ecoNamesOf(graph, account.locale),
  };
}
