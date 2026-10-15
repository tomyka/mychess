import type { PageServerLoad } from './$types';
import { ensureDailyQuests } from '$lib/server/quests';
import { mapFideRow, ratingsByKind } from '$lib/fide/rank';
import { loadFideLookup } from '$lib/server/fide-lookup';
import { fetchLichessRatings } from '$lib/server/lichess';
import { fetchChesscomRatings } from '$lib/server/chesscom';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  const isSignedOut = !user;

  // Fetch upcoming Lithuania tournaments for all visitors (signed-out landing
  // page + logged-in widget). Kicked off here but not awaited yet — it doesn't
  // depend on the session/profile above, so there's no reason to serialize it
  // ahead of the signed-out-vs-logged-in branch or the parallel batch below;
  // it's awaited only where its result is actually needed, in each branch.
  const todayDate = new Date().toISOString().slice(0, 10);
  const tournamentsPromise = supabase
    .from('tournaments')
    .select('id, name, city, country, start_date, time_control, status, average_rating')
    .in('status', ['NOT_STARTED', 'IN_PROGRESS'])
    .eq('country', 'Lithuania')
    .gte('start_date', todayDate)
    .order('start_date', { ascending: true })
    .limit(15);

  // Public FIDE rank lookup (?fide=<id>) — reads the public fide_players table.
  const fideQuery = (url.searchParams.get('fide') ?? '').trim();
  const fideLookup = await loadFideLookup(supabase, fideQuery);

  // Signed-out visitors get the public landing — don't run the authenticated
  // pipeline (quest seeding, leaderboard) for them.
  if (isSignedOut) {
    const { data: upcomingTournaments, error: tErr } = await tournamentsPromise;
    if (tErr) console.error('Failed to fetch upcoming tournaments:', tErr);
    return { isSignedOut: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };
  }

  const p = profile as any;
  const streakDays = Number(p?.streak_days ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const lichessUsername = p?.lichess_username ?? null;
  const chesscomUsername = p?.chesscom_username ?? null;

  // Lichess/Chess.com ratings hit an external API with a 5s timeout each —
  // fired here so they're in flight alongside everything else, but
  // deliberately NOT part of the Promise.all below: they're returned as
  // unresolved promises so the page can stream (see the {#await} blocks in
  // +page.svelte) instead of the whole dashboard response blocking on two
  // slow external calls that have nothing to do with the rest of the data.
  const lichessRatingsPromise = lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null);
  const chesscomRatingsPromise = chesscomUsername ? fetchChesscomRatings(chesscomUsername) : Promise.resolve(null);

  // Parallel fetches
  const [statsRes, quests, noteRes, fideRes, repertoireSummaries, tournamentsRes] = await Promise.all([
    supabase
      .from('player_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('player_id', user.id)
      .single(),
    ensureDailyQuests(supabase, user.id, today),
    supabase
      .from('coach_notes')
      .select('id, note, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    // FIDE Lithuania ratings + per-type ranks (from the monthly imported list), keyed by FIDE ID.
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select(
            'name, std_rating, rapid_rating, blitz_rating, ' +
            'country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, ' +
            'age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz, ' +
            'europe_age_group_rank_standard, europe_age_group_rank_rapid, europe_age_group_rank_blitz'
          )
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    loadRepertoireProgressSummaries(supabase, user.id),
    tournamentsPromise
  ]);

  const { data: upcomingTournaments, error: tErr } = tournamentsRes;
  if (tErr) console.error('Failed to fetch upcoming tournaments:', tErr);

  // A missing row returns a PGRST116 error, which we treat as "unranked" (null).
  // A genuine failure is worth surfacing.
  if (fideRes.error && fideRes.error.code !== 'PGRST116') {
    console.error('Failed to fetch FIDE ratings:', fideRes.error);
  }
  const fideProfile = fideRes.data ? mapFideRow(fideRes.data as any) : null;
  const fideRatings = fideProfile ? ratingsByKind(fideProfile) : null;

  // A repertoire with no moves yet is vacuously "mastered" by
  // repertoireProgress's math — exclude it from both sides of this ratio, it
  // isn't meaningfully masterable yet.
  const masterableRepertoires = repertoireSummaries.filter((r) => r.total > 0);
  const masteredRepertoireCount = masterableRepertoires.filter((r) => r.allSolved).length;

  return {
    isSignedOut,
    session,
    profile,
    lichessUsername,
    lichessRatings: lichessRatingsPromise,
    chesscomUsername,
    chesscomRatings: chesscomRatingsPromise,
    fideRatings,
    stats: {
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0,
      mastered_repertoires: masteredRepertoireCount,
      total_masterable_repertoires: masterableRepertoires.length
    },
    quests,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    upcomingTournaments: upcomingTournaments ?? [],
    fideLookup,
    fideQuery
  };
};
