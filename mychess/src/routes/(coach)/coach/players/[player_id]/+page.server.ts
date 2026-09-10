import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { loadRepertoireReport } from '$lib/server/practice-report';
import { loadStudentRepertoireProgress } from '$lib/server/coach-progress';
import { activateOpeningIfUnset, loadActiveOpenings, setActiveOpening } from '$lib/server/active-openings';
import { REPERTOIRE_OPENING_COLUMNS } from '$lib/openings/active';

const RANGE_DAYS = 30;

export const load: PageServerLoad = async ({ params, url, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const range = url.searchParams.get('range') === 'all' ? 'all' : '30d';
  const now = new Date();
  const sinceIso = range === 'all' ? null : new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes, activeOpenings] = await Promise.all([
    supabase.from('profiles').select('id, display_name').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select(`id, repertoire:repertoire_id(name, ${REPERTOIRE_OPENING_COLUMNS})`)
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id),
    loadActiveOpenings(supabase, params.player_id)
  ]);

  const assignedReps = assignedRes.data ?? [];

  // Learning progress for every assigned repertoire in four queries, rather
  // than more per-repertoire round trips on a page that already makes several.
  const progressByRep = await loadStudentRepertoireProgress(
    supabase,
    params.player_id,
    assignedReps.map((a: any) => a.repertoire?.id).filter(Boolean),
    sinceIso
  );

  const practiceReports = await Promise.all(
    assignedReps.map(async (a: any) => {
      if (!a.repertoire?.id) return { repertoireId: null, repertoireName: a.repertoire?.name ?? 'Repertoire', solved: 0, total: 0, report: null };
      const [{ data: repRow }, { count: solvedCount }, report] = await Promise.all([
        supabase.from('repertoires').select('total_variations').eq('id', a.repertoire.id).maybeSingle(),
        supabase
          .from('variation_solved')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', params.player_id)
          .eq('repertoire_id', a.repertoire.id),
        loadRepertoireReport(supabase, params.player_id, a.repertoire.id, sinceIso, now)
      ]);
      const progress = progressByRep.get(a.repertoire.id);
      const total = repRow?.total_variations ?? 0;
      const learned = progress?.learned ?? solvedCount ?? 0;
      return {
        repertoireId: a.repertoire.id,
        repertoireName: a.repertoire.name,
        solved: learned,
        total,
        status: total > 0 && learned >= total ? 'learned' : 'learning',
        level: progress?.level ?? null,
        demotions: progress?.demotions ?? 0,
        report
      };
    })
  );

  return {
    player: playerRes.data,
    stats: statsRes.data,
    notes: notesRes.data ?? [],
    coachReps: coachRepsRes.data ?? [],
    assignedReps,
    practiceReports,
    activeRepertoireIds: [...activeOpenings.values()].map((repertoire) => repertoire.id),
    range,
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

    // The first repertoire a student has for an opening becomes their active
    // preparation for it (GitHub issue #202); a later one never displaces it,
    // so a coach holding one student on last season's file keeps them there.
    // Non-fatal for the same reason as the import path: the assignment itself
    // succeeded, and failing it over the mapping would be the worse outcome.
    const activation = await activateOpeningIfUnset(supabase, {
      playerId: params.player_id,
      repertoireId: repId,
      setBy: user.id
    });
    if (activation.error) {
      console.error(`Failed to set the active opening for repertoire ${repId}:`, activation.error);
    }

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
  },

  setActive: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    // A repertoire resolving to no curated opening has nothing to be active
    // for, and RLS independently refuses a repertoire this student cannot see.
    const { error } = await setActiveOpening(supabase, {
      playerId: params.player_id,
      repertoireId: repId,
      setBy: user.id
    });
    if (error) return fail(400, { error });
    return { success: true };
  }
};
