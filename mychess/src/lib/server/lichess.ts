export type LichessRatings = {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  classical?: number;
};

const VARIANTS = ['bullet', 'blitz', 'rapid', 'classical'] as const;

export async function fetchLichessRatings(username: string): Promise<LichessRatings | null> {
  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MyChess/1.0' },
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.error(`Failed to reach Lichess for user ${username}:`, e);
    return null;
  }

  if (!res.ok) {
    console.error(`Lichess API returned ${res.status} for user ${username}`);
    return null;
  }

  try {
    const data = await res.json();
    const perfs = data?.perfs ?? {};
    const ratings: LichessRatings = {};
    for (const variant of VARIANTS) {
      const perf = perfs[variant];
      if (perf && typeof perf.rating === 'number' && perf.games > 0) {
        ratings[variant] = perf.rating;
      }
    }
    return ratings;
  } catch (e) {
    console.error(`Failed to parse Lichess response for user ${username}:`, e);
    return null;
  }
}
