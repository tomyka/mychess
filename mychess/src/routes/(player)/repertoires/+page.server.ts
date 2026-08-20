import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const [{ data: repertoires }, { data: assigned }, summaries] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, eco_code, eco_name, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id ( id, name, color, eco_code, eco_name, moves(count) )')
			.eq('player_id', user!.id),
		loadRepertoireProgressSummaries(supabase, user!.id)
	]);
	const assignedRepertoires = (assigned ?? [])
		.map((a: any) => a.repertoire)
		.filter(Boolean);

	// Whether every variation is already learned — decides which button a
	// repertoire's card shows (Learn while anything's outstanding, Practice
	// once it's all learned). `loadRepertoireProgressSummaries` already exists
	// to answer this cheaply elsewhere (badge counts), so this reuses it
	// rather than re-deriving solved/total here.
	const allSolvedById = new Map(summaries.map((s) => [s.id, s.allSolved]));
	const withStatus = (rep: any) => ({ ...rep, allSolved: allSolvedById.get(rep.id) ?? false });

	return {
		repertoires: (repertoires ?? []).map(withStatus),
		assignedRepertoires: assignedRepertoires.map(withStatus)
	};
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase.from('repertoires').delete().eq('id', repId).eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	},

	updateOpening: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const ecoCode = (fd.get('eco_code') as string) || null;
		const ecoName = (fd.get('eco_name') as string) || null;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase
			.from('repertoires')
			.update({ eco_code: ecoCode, eco_name: ecoName })
			.eq('id', repId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
