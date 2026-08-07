import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importGames } from '$lib/server/pgn-import';
import { requireApiUser } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const user = await requireApiUser(locals);

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
      headers: { 'Accept': 'application/x-chess-pgn', 'User-Agent': 'MyChess/1.0' }
    });
    if (!res.ok) throw error(502, `Lichess returned ${res.status}. Check your username.`);
    pgn = await res.text();
  } catch (e: any) {
    if (e.status) throw e;
    throw error(502, 'Failed to reach Lichess. Try again later.');
  }

  if (!pgn.trim()) return json({ count: 0 });

  const now = new Date();
  const repName = `Lichess Import ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const result = await importGames(supabase, { playerId: user.id, username, name: repName, pgnText: pgn });
  if (result.error) throw error(500, result.error);
  return json({ count: result.gameCount });
};
