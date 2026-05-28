import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';
import { selectDailyQuests } from '$lib/quests/generate';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) return { session: null, profile: null };

  const p = profile as any;
  const totalXp = Number(p?.xp ?? 0);
  const streakDays = Number(p?.streak_days ?? 0);
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);
  const today = new Date().toISOString().slice(0, 10);

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes] = await Promise.all([
    supabase
      .from('kid_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('kid_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('kid_id', user.id)
      .eq('date', today),
    supabase
      .from('weekly_leaderboard')
      .select('kid_id, weekly_xp, rank')
      .order('rank', { ascending: true })
      .limit(10),
    supabase
      .from('coach_notes')
      .select('id, message, created_at')
      .eq('kid_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
  ]);

  // Seed quests if none exist for today
  let quests = questsRes.data ?? [];
  if (quests.length === 0) {
    const templates = selectDailyQuests(today, user.id);
    const rows = templates.map(t => ({
      kid_id: user.id,
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
  const kidIds = lbData.map((r: any) => r.kid_id);
  let lbEntries: any[] = [];
  if (kidIds.length > 0) {
    const { data: names } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_id')
      .in('id', kidIds);
    const nameMap = new Map((names ?? []).map((n: any) => [n.id, n]));
    lbEntries = lbData.map((r: any) => ({
      rank: r.rank,
      kid_name: nameMap.get(r.kid_id)?.display_name ?? 'Player',
      avatar_id: nameMap.get(r.kid_id)?.avatar_id ?? 'knight',
      weekly_xp: r.weekly_xp,
      is_current_user: r.kid_id === user.id
    }));
  }

  return {
    session,
    profile,
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
    avatarId: p?.avatar_id ?? 'knight'
  };
};
