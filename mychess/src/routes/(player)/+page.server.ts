import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';
import { selectDailyQuests } from '$lib/quests/generate';
import { fetchLichessRatings } from '$lib/server/lichess';
import { fetchChesscomRatings } from '$lib/server/chesscom';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  const isGuest = !user || !!(user as any).is_anonymous;

  // Fetch upcoming Lithuania tournaments for all visitors (guest landing page + logged-in widget)
  const todayDate = new Date().toISOString().slice(0, 10);
  const { data: upcomingTournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, city, country, start_date, time_control, status, average_rating')
    .in('status', ['NOT_STARTED', 'IN_PROGRESS'])
    .eq('country', 'Lithuania')
    .gte('start_date', todayDate)
    .order('start_date', { ascending: true })
    .limit(15);

  if (tErr) console.error('Failed to fetch upcoming tournaments:', tErr);

  // Public FIDE rank lookup (?fide=<id>) — reads the public fide_players table.
  const fideQuery = (url.searchParams.get('fide') ?? '').trim();
  let fideLookup: { query: string; found: boolean; player?: any } | null = null;
  if (fideQuery) {
    const { data: row } = await supabase
      .from('fide_players')
      .select('name, std_rating, rapid_rating, blitz_rating, country_rank_standard, age_bracket, age_group_rank_standard')
      .eq('fide_id', fideQuery)
      .single();
    fideLookup = row
      ? {
          query: fideQuery,
          found: true,
          player: {
            name: (row as any).name,
            stdRating: (row as any).std_rating,
            rapidRating: (row as any).rapid_rating,
            blitzRating: (row as any).blitz_rating,
            countryRankStandard: (row as any).country_rank_standard,
            ageBracket: (row as any).age_bracket,
            ageGroupRankStandard: (row as any).age_group_rank_standard
          }
        }
      : { query: fideQuery, found: false };
  }

  if (!user) return { isGuest: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };

  const p = profile as any;
  const totalXp = Number(p?.xp ?? 0);
  const streakDays = Number(p?.streak_days ?? 0);
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);
  const today = new Date().toISOString().slice(0, 10);
  const lichessUsername = p?.lichess_username ?? null;
  const chesscomUsername = p?.chesscom_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
    supabase
      .from('player_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('player_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today),
    supabase
      .from('weekly_leaderboard')
      .select('player_id, weekly_xp, rank')
      .order('rank', { ascending: true })
      .limit(10),
    supabase
      .from('coach_notes')
      .select('id, message, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    chesscomUsername ? fetchChesscomRatings(chesscomUsername) : Promise.resolve(null),
    // FIDE Lithuania ratings + per-type ranks (from the monthly imported list), keyed by FIDE ID.
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select(
            'std_rating, rapid_rating, blitz_rating, ' +
            'country_rank_standard, country_rank_rapid, country_rank_blitz, ' +
            'age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz'
          )
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null })
  ]);

  // A missing row returns a PGRST116 error, which we treat as "unranked" (null).
  // A genuine failure is worth surfacing.
  if (fideRes.error && fideRes.error.code !== 'PGRST116') {
    console.error('Failed to fetch FIDE ratings:', fideRes.error);
  }
  const fide = fideRes.data as any;
  const fideRatings = fide
    ? {
        standard: {
          rating: fide.std_rating ?? null,
          countryRank: fide.country_rank_standard ?? null,
          ageGroupRank: fide.age_group_rank_standard ?? null
        },
        rapid: {
          rating: fide.rapid_rating ?? null,
          countryRank: fide.country_rank_rapid ?? null,
          ageGroupRank: fide.age_group_rank_rapid ?? null
        },
        blitz: {
          rating: fide.blitz_rating ?? null,
          countryRank: fide.country_rank_blitz ?? null,
          ageGroupRank: fide.age_group_rank_blitz ?? null
        }
      }
    : null;

  // Seed quests if none exist for today
  let quests = questsRes.data ?? [];
  if (quests.length === 0) {
    const templates = selectDailyQuests(today, user.id);
    const rows = templates.map(t => ({
      player_id: user.id,
      date: today,
      quest_id: t.id,
      description: t.description,
      target: t.target,
      progress: 0,
      xp_reward: t.xpReward,
      completed: false
    }));
    const { data: inserted } = await supabase.from('quests').insert(rows).select();
    quests = inserted ?? [];
  }

  // Enrich leaderboard with display names
  const lbData = leaderboardRes.data ?? [];
  const playerIds = lbData.map((r: any) => r.player_id);
  let lbEntries: any[] = [];
  if (playerIds.length > 0) {
    const { data: names } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_id')
      .in('id', playerIds);
    const nameMap = new Map((names ?? []).map((n: any) => [n.id, n]));
    lbEntries = lbData.map((r: any) => ({
      rank: r.rank,
      player_name: nameMap.get(r.player_id)?.display_name ?? 'Player',
      avatar_id: nameMap.get(r.player_id)?.avatar_id ?? 'knight',
      weekly_xp: r.weekly_xp,
      is_current_user: r.player_id === user.id
    }));
  }

  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    chesscomUsername,
    chesscomRatings,
    fideRatings,
    stats: {
      level,
      total_xp: totalXp,
      xp_in_level: xpInLevel,
      xp_to_next: xpToNextLevel,
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
    quests,
    leaderboard: lbEntries,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    upcomingTournaments: upcomingTournaments ?? [],
    fideLookup,
    fideQuery
  };
};
