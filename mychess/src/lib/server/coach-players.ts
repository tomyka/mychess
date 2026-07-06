// mychess/src/lib/server/coach-players.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planRequest } from '$lib/coach-players';

export type DirectoryEntry = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  avatar_id: string;
};

export type RelationshipEntry = {
  id: string;
  status: 'pending' | 'active';
  requested_by: string;
  other: DirectoryEntry;
};

type Role = 'player' | 'coach';

function toIds(coachId: string, playerId: string) {
  return { coach_id: coachId, player_id: playerId };
}

/** Sends a request from `requesterId` (whose role is `requesterRole`) to `otherId`. */
export async function sendRequest(
  supabase: SupabaseClient,
  params: { requesterId: string; requesterRole: Role; otherId: string }
): Promise<{ error: string | null }> {
  const { requesterId, requesterRole, otherId } = params;
  const { coach_id, player_id } =
    requesterRole === 'coach' ? toIds(requesterId, otherId) : toIds(otherId, requesterId);

  const { data: existing } = await supabase
    .from('coach_players')
    .select('status, requested_by')
    .eq('coach_id', coach_id)
    .eq('player_id', player_id)
    .maybeSingle();

  const outcome = planRequest(existing as any, requesterId);
  if (!outcome.ok) return { error: outcome.error };

  const { error } = await supabase
    .from('coach_players')
    .insert({ coach_id, player_id, status: 'pending', requested_by: requesterId });

  if (error?.code === '23505') {
    // Lost a race with a concurrent insert for the same pair.
    return { error: 'There is already a pending or active relationship between you.' };
  }
  return { error: error?.message ?? null };
}

/** Accepts or declines a pending request. `responderId` must be the non-requester party. */
export async function respondToRequest(
  supabase: SupabaseClient,
  params: { responderId: string; relationshipId: string; accept: boolean }
): Promise<{ error: string | null }> {
  const { responderId, relationshipId, accept } = params;

  if (accept) {
    const { data, error } = await supabase
      .from('coach_players')
      .update({ status: 'active', responded_at: new Date().toISOString() })
      .eq('id', relationshipId)
      .eq('status', 'pending')
      .neq('requested_by', responderId)
      .select();
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: 'This request is no longer available.' };
    return { error: null };
  }

  const { data, error } = await supabase
    .from('coach_players')
    .delete()
    .eq('id', relationshipId)
    .eq('status', 'pending')
    .select();
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'This request is no longer available.' };
  return { error: null };
}

/** Ends an active relationship. Either participant may call this. */
export async function unlink(
  supabase: SupabaseClient,
  params: { userId: string; relationshipId: string }
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('coach_players')
    .delete()
    .eq('id', params.relationshipId)
    .eq('status', 'active')
    .select();
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'This relationship no longer exists.' };
  return { error: null };
}

function splitByStatus(rows: any[]): { active: RelationshipEntry[]; pending: RelationshipEntry[] } {
  const active: RelationshipEntry[] = [];
  const pending: RelationshipEntry[] = [];
  for (const row of rows) {
    (row.status === 'active' ? active : pending).push(row);
  }
  return { active, pending };
}

/** Lists a player's coach relationships (active + pending, either direction of request). */
export async function listRelationshipsForPlayer(supabase: SupabaseClient, playerId: string) {
  const { data } = await supabase
    .from('coach_players')
    .select(
      'id, status, requested_by, other:profiles!coach_players_coach_id_fkey(id, first_name, last_name, display_name, avatar_id)'
    )
    .eq('player_id', playerId);
  return splitByStatus((data ?? []) as any[]);
}

/** Lists a coach's player relationships (active + pending, either direction of request). */
export async function listRelationshipsForCoach(supabase: SupabaseClient, coachId: string) {
  const { data } = await supabase
    .from('coach_players')
    .select(
      'id, status, requested_by, other:profiles!coach_players_player_id_fkey(id, first_name, last_name, display_name, avatar_id)'
    )
    .eq('coach_id', coachId);
  return splitByStatus((data ?? []) as any[]);
}

async function browseDirectory(
  supabase: SupabaseClient,
  table: 'coach_directory' | 'player_directory',
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  let query = supabase.from(table).select('id, first_name, last_name, display_name, avatar_id');
  if (params.excludeIds.length > 0) {
    query = query.not('id', 'in', `(${params.excludeIds.join(',')})`);
  }
  if (params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    query = query.or(`first_name.ilike.${term},last_name.ilike.${term},display_name.ilike.${term}`);
  }
  const { data, error } = await query.order('display_name', { ascending: true });
  return { entries: (data ?? []) as DirectoryEntry[], error: error?.message ?? null };
}

/** Browses coaches not already connected (pending or active) to `excludeIds`. */
export function browseCoaches(
  supabase: SupabaseClient,
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  return browseDirectory(supabase, 'coach_directory', params);
}

/** Browses players not already connected (pending or active) to `excludeIds`. */
export function browsePlayers(
  supabase: SupabaseClient,
  params: { excludeIds: string[]; search: string }
): Promise<{ entries: DirectoryEntry[]; error: string | null }> {
  return browseDirectory(supabase, 'player_directory', params);
}
