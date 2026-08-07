import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select('id, repertoire:repertoire_id(id, name, color)')
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
  ]);

  return {
    player: playerRes.data,
    stats: statsRes.data,
    notes: notesRes.data ?? [],
    coachReps: coachRepsRes.data ?? [],
    assignedReps: assignedRes.data ?? [],
    playerId: params.player_id
  };
};

export const actions: Actions = {
  addNote: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const note = ((fd.get('note') as string) ?? '').trim();
    if (!note) return fail(400, { error: 'Note cannot be empty' });

    const { error } = await supabase
      .from('coach_notes')
      .insert({ player_id: params.player_id, coach_id: user.id, note });

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  assignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    // Confirm this coach actually owns the repertoire before assigning it —
    // the RLS policy enforces the same check server-side (see migration
    // 0030), but checking here gives a clean 400 instead of a generic
    // RLS-rejection 500 for what's really a bad/foreign repertoire_id.
    const { data: ownedRep } = await supabase
      .from('repertoires')
      .select('id')
      .eq('id', repId)
      .eq('player_id', user.id)
      .maybeSingle();
    if (!ownedRep) return fail(400, { error: 'Repertoire not found' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert(
        { player_id: params.player_id, coach_id: user.id, repertoire_id: repId },
        { onConflict: 'player_id,repertoire_id' }
      );

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  unassignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .delete()
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
      .eq('repertoire_id', repId);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
