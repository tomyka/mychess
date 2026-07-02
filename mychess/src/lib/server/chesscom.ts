export type ChesscomRatings = {
  rapid?: number;
  blitz?: number;
  bullet?: number;
  puzzle?: number;
};

export async function fetchChesscomRatings(username: string): Promise<ChesscomRatings | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MyChess/1.0' },
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.error(`Failed to reach Chess.com for user ${username}:`, e);
    return null;
  }

  if (!res.ok) {
    console.error(`Chess.com API returned ${res.status} for user ${username}`);
    return null;
  }

  try {
    const data = await res.json();
    const ratings: ChesscomRatings = {};
    if (typeof data?.chess_rapid?.last?.rating === 'number') ratings.rapid = data.chess_rapid.last.rating;
    if (typeof data?.chess_blitz?.last?.rating === 'number') ratings.blitz = data.chess_blitz.last.rating;
    if (typeof data?.chess_bullet?.last?.rating === 'number') ratings.bullet = data.chess_bullet.last.rating;
    if (typeof data?.tactics?.highest?.rating === 'number') ratings.puzzle = data.tactics.highest.rating;
    return ratings;
  } catch (e) {
    console.error(`Failed to parse Chess.com response for user ${username}:`, e);
    return null;
  }
}
