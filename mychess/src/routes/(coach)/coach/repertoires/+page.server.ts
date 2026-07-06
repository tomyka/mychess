import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;

	const [repsRes, assignedRes, relationships] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
		supabase
			.from('assigned_repertoires')
			.select('repertoire_id, player:profiles!assigned_repertoires_player_id_fkey(id, display_name)')
			.eq('coach_id', user!.id),
		listRelationshipsForCoach(supabase, user!.id)
	]);

	const assignedByRep = new Map<string, { id: string; display_name: string }[]>();
	for (const row of (assignedRes.data ?? []) as any[]) {
		if (!row.player) continue;
		const list = assignedByRep.get(row.repertoire_id) ?? [];
		list.push(row.player);
		assignedByRep.set(row.repertoire_id, list);
	}

	return {
		repertoires: (repsRes.data ?? []).map((rep: any) => ({
			...rep,
			assignedPlayers: assignedByRep.get(rep.id) ?? []
		})),
		players: relationships.active.map((r) => r.other)
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

	assign: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const playerId = fd.get('player_id') as string;
		if (!repId || !playerId) return fail(400, { error: 'Pick a player to assign to' });

		const { error } = await supabase
			.from('assigned_repertoires')
			.upsert(
				{ player_id: playerId, coach_id: user!.id, repertoire_id: repId },
				{ onConflict: 'player_id,repertoire_id' }
			);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
