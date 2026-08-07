import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importGames } from '$lib/server/pgn-import';
import { requireApiUser } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const user = await requireApiUser(locals);

  const { data: profile } = await supabase
    .from('profiles')
    .select('chesscom_username')
    .eq('id', user.id)
    .single();

  const username = (profile as any)?.chesscom_username;
  if (!username) throw error(400, 'No chess.com username saved. Go to Settings first.');

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${month}`;

  let chessGames: any[];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'MyChess/1.0' } });
    if (!res.ok) throw error(502, `Chess.com returned ${res.status}. Check your username.`);
    const body = await res.json();
    chessGames = body.games ?? [];
  } catch (e: any) {
    if (e.status) throw e;
    throw error(502, 'Failed to reach chess.com. Try again later.');
  }

  if (chessGames.length === 0) return json({ count: 0 });

  const recent = chessGames.slice(-20);
  const combinedPgn = recent.map((g: any) => g.pgn ?? '').filter(Boolean).join('\n\n');
  if (!combinedPgn) return json({ count: 0 });

  const repName = `Chess.com Import ${year}-${month}`;
  const result = await importGames(supabase, { playerId: user.id, username, name: repName, pgnText: combinedPgn });
  if (result.error) throw error(500, result.error);
  return json({ count: result.gameCount });
};
