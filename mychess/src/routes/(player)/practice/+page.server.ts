import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type MoveProgressRow } from '$lib/mastery/moveProgress';

export const load: PageServerLoad = async ({ locals }) => {
  const { user } = await requireAccount(locals);
  const supabase = locals.supabase;

  const [{ data: ownReps }, { data: assigned }] = await Promise.all([
    supabase.from('repertoires').select('id, name, color').eq('player_id', user!.id),
    supabase
      .from('assigned_repertoires')
      .select('repertoire:repertoire_id(id, name, color)')
      .eq('player_id', user!.id)
  ]);

  const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
  const seen = new Set((ownReps ?? []).map((r: any) => r.id));
  const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

  if (allReps.length === 0) {
    return { repertoires: [] };
  }

  const repIds = allReps.map((r: any) => r.id);
  const { data: rawMoves } = await supabase
    .from('moves')
    .select('id, san, is_player_turn, repertoire_id, from_position, to_position')
    .in('repertoire_id', repIds);

  // This page only needs level/satisfiedCount/totalVariations, all derived
  // purely from moveId/isPlayerTurn — never from FEN — so the fen columns
  // aren't fetched here (unlike the [repertoire_id] detail page, which needs
  // them to render the board).
  const movesByRep = new Map<string, RawMoveRow[]>();
  for (const m of (rawMoves ?? []) as any[]) {
    const list = movesByRep.get(m.repertoire_id) ?? [];
    list.push({
      id: m.id,
      san: m.san,
      isPlayerTurn: m.is_player_turn,
      fromPositionId: m.from_position,
      toPositionId: m.to_position,
      fromFen: '',
      toFen: ''
    });
    movesByRep.set(m.repertoire_id, list);
  }

  const allMoveIds = (rawMoves ?? []).map((m: any) => m.id);
  const { data: progressRows } = allMoveIds.length
    ? await supabase
        .from('move_progress')
        .select('move_id, state')
        .eq('player_id', user!.id)
        .in('move_id', allMoveIds)
    : { data: [] as MoveProgressRow[] };

  const repertoires = allReps.map((r: any) => {
    const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
    // `progressRows` spans every repertoire's move ids at once (one query),
    // but repertoireProgress only ever looks up ids that appear in this
    // repertoire's own `variations`, so passing the full set is harmless —
    // no need to pre-split it per repertoire.
    const progress = repertoireProgress(variations, progressRows ?? []);
    return { id: r.id, name: r.name, color: r.color, ...progress };
  });

  return { repertoires };
};
