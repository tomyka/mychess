import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { listRelationshipsForCoach } from '$lib/server/coach-players';
import { repointActiveOpenings, updateRepertoireEco } from '$lib/server/active-openings';
import { CURATED_OPENINGS } from '$lib/openings/taxonomy';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;

	const [repsRes, assignedRes, relationships] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, eco_code, eco_name, opening_id, created_at, moves(count)')
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

		// Confirm this coach actually owns the repertoire before assigning it —
		// the RLS policy enforces the same check server-side (see migration
		// 0030), but checking here gives a clean 400 instead of a generic
		// RLS-rejection 500 for what's really a bad/foreign repertoire_id.
		const { data: ownedRep } = await supabase
			.from('repertoires')
			.select('id')
			.eq('id', repId)
			.eq('player_id', user!.id)
			.maybeSingle();
		if (!ownedRep) return fail(400, { error: 'Repertoire not found' });

		const { error } = await supabase
			.from('assigned_repertoires')
			.upsert(
				{ player_id: playerId, coach_id: user!.id, repertoire_id: repId },
				{ onConflict: 'player_id,repertoire_id' }
			);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	},

	unassign: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const playerId = fd.get('player_id') as string;
		if (!repId || !playerId) return fail(400, { error: 'No player selected' });

		const { error } = await supabase
			.from('assigned_repertoires')
			.delete()
			.eq('coach_id', user!.id)
			.eq('repertoire_id', repId)
			.eq('player_id', playerId);
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

		const { error } = await updateRepertoireEco(supabase, {
			ownerId: user!.id,
			repertoireId: repId,
			ecoCode,
			ecoName
		});
		if (error) return fail(500, { error });

		return { success: true };
	},

	// GitHub issue #201. Distinct from `updateOpening` above, which sets the ECO
	// code: this one records which curated opening the repertoire prepares. An
	// empty value clears the override and returns the repertoire to derivation.
	updateCuratedOpening: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const openingId = (fd.get('opening_id') as string) || null;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		// There's no foreign key on `opening_id` — the taxonomy is guarded by
		// tests, not a constraint — so this is the one place an id actually
		// enters the database and the only chance to reject a bogus one. Empty
		// is the picker's "Auto" choice and must keep clearing the override.
		//
		// Deliberately not also checking the entry's `side` against the
		// repertoire's `color` here: doing so needs the row's colour, which
		// means a read before the write on every submission, and
		// `resolveOpening` already falls back to null (the ECO line) for a
		// side mismatch at render time — see its docstring. The picker itself
		// only ever offers same-colour entries, so a mismatch here would mean
		// the row was edited directly or its colour changed after the fact,
		// which is already handled safely downstream.
		if (openingId && !CURATED_OPENINGS.some((opening) => opening.id === openingId)) {
			return fail(400, { error: 'Unknown opening' });
		}

		const { error } = await supabase
			.from('repertoires')
			.update({ opening_id: openingId })
			.eq('id', repId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		// This write changes what `resolveOpening` answers, so every student's
		// active mapping for this repertoire has to follow it (GitHub issue
		// #210) — otherwise a correction silently costs them their preparation.
		await repointActiveOpenings(supabase, repId);

		return { success: true };
	}
};
