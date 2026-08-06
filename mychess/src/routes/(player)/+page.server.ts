import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
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
      .select('name, std_rating, rapid_rating, blitz_rating, country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz')
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
            countryRankRapid: (row as any).country_rank_rapid,
            countryRankBlitz: (row as any).country_rank_blitz,
            ageBracket: (row as any).age_bracket,
            ageGroupRankStandard: (row as any).age_group_rank_standard,
            ageGroupRankRapid: (row as any).age_group_rank_rapid,
            ageGroupRankBlitz: (row as any).age_group_rank_blitz
          }
        }
      : { query: fideQuery, found: false };
  }

  // Guests (no session AND anonymous) get the public landing — don't run the
  // authenticated pipeline (quest seeding, leaderboard) for throwaway accounts.
  if (isGuest) return { isGuest: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };

  const p = profile as any;
  const streakDays = Number(p?.streak_days ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const lichessUsername = p?.lichess_username ?? null;
  const chesscomUsername = p?.chesscom_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
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
      .from('coach_notes')
      .select('id, note, created_at')
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
      completed: false
    }));
    const { data: inserted } = await supabase.from('quests').insert(rows).select();
    quests = inserted ?? [];
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
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
    quests,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    upcomingTournaments: upcomingTournaments ?? [],
    fideLookup,
    fideQuery
  };
};
