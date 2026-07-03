import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const { user, session, profile } = await requireAccount(locals);
  const supabase = locals.supabase;

  const [allRes, earnedRes] = await Promise.all([
    supabase.from('badges').select('id, name, description, icon_url, xp_reward').order('xp_reward', { ascending: true }),
    supabase.from('badges_earned').select('badge_id, earned_at').eq('player_id', user!.id)
  ]);

  const earnedMap = new Map((earnedRes.data ?? []).map((e: any) => [e.badge_id, e.earned_at]));

  const badges = (allRes.data ?? []).map((b: any) => ({
    ...b,
    earned: earnedMap.has(b.id),
    earned_at: earnedMap.get(b.id) ?? null
  }));

  return { session, profile, badges };
};
