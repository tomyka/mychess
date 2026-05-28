import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parsePgn } from '$lib/pgn/parser';

export const POST: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('lichess_username')
    .eq('id', user.id)
    .single();

  const username = (profile as any)?.lichess_username;
  if (!username) throw error(400, 'No Lichess username saved. Go to Settings first.');

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&pgnInJson=false`;

  let pgn: string;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/x-chess-pgn', 'User-Agent': 'KidChess/1.0' }
    });
    if (!res.ok) throw error(502, `Lichess returned ${res.status}. Check your username.`);
    pgn = await res.text();
  } catch (e: any) {
    if (e.status) throw e;
    throw error(502, 'Failed to reach Lichess. Try again later.');
  }

  const parsed = parsePgn(pgn);
  if (parsed.length === 0) return json({ count: 0 });

  const now = new Date();
  const repName = `Lichess Import ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: rep } = await supabase
    .from('repertoires')
    .insert({ kid_id: user.id, name: repName, color: '#60a5fa' })
    .select()
    .single();
  if (!rep) throw error(500, 'Failed to create repertoire.');

  const allFens = new Set<string>();
  for (const game of parsed) {
    allFens.add(game.root_fen);
    for (const m of game.moves) { allFens.add(m.fen); allFens.add(m.parentFen); }
  }
  await supabase.from('positions').upsert([...allFens].map(fen => ({ fen })), { onConflict: 'fen', ignoreDuplicates: true });
  const { data: positions } = await supabase.from('positions').select('id, fen').in('fen', [...allFens]);
  const fenToId = new Map((positions ?? []).map((p: any) => [p.fen, p.id]));

  const moveRows: any[] = [];
  for (const game of parsed) {
    for (const m of game.moves) {
      const fromId = fenToId.get(m.parentFen);
      const toId = fenToId.get(m.fen);
      if (!fromId || !toId) continue;
      moveRows.push({ repertoire_id: rep.id, from_position: fromId, to_position: toId, san: m.san, color: m.color, move_number: Math.ceil(m.ply / 2) });
    }
  }
  if (moveRows.length > 0) {
    await supabase.from('moves').upsert(moveRows, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
  }
  return json({ count: parsed.length });
};
