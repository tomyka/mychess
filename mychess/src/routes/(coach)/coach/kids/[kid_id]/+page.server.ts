import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { levelFromXp } from '$lib/srs/xp';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [kidRes, statsRes, repsRes, notesRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name, weekly_xp_goal').eq('id', params.kid_id).single(),
    supabase.from('kid_stats').select('*').eq('kid_id', params.kid_id).single(),
    supabase.from('repertoires').select('id, name, color').eq('kid_id', params.kid_id),
    supabase.from('coach_notes').select('*').eq('kid_id', params.kid_id).order('created_at', { ascending: false }).limit(5)
  ]);

  // Coach's own repertoires for assignment
  const { data: coachReps } = await supabase
    .from('repertoires')
    .select('id, name, color')
    .eq('kid_id', user.id);

  const totalXp = statsRes.data?.total_xp ?? 0;
  const levelInfo = levelFromXp(totalXp);

  return {
    kid: kidRes.data,
    stats: { ...statsRes.data, ...levelInfo },
    repertoires: repsRes.data ?? [],
    coachReps: coachReps ?? [],
    notes: notesRes.data ?? [],
    kidId: params.kid_id
  };
};

export const actions: Actions = {
  setGoal: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const weeklyGoal = Number(fd.get('weekly_xp_goal'));
    if (isNaN(weeklyGoal) || weeklyGoal < 0) return fail(400, { error: 'Invalid goal' });

    const { error } = await supabase
      .from('profiles')
      .update({ weekly_xp_goal: weeklyGoal })
      .eq('id', params.kid_id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  addNote: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const message = (fd.get('message') as string ?? '').trim();
    if (!message) return fail(400, { error: 'Note cannot be empty' });

    const { error } = await supabase
      .from('coach_notes')
      .insert({ kid_id: params.kid_id, coach_id: user.id, message });

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  assignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert({ kid_id: params.kid_id, coach_id: user.id, repertoire_id: repId });

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
