import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	sendRequest,
	respondToRequest,
	unlink,
	listRelationshipsForCoach,
	browsePlayers
} from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active, pending } = await listRelationshipsForCoach(supabase, user!.id);

	const connectedIds = [...active, ...pending].map((r) => r.other.id);
	const search = url.searchParams.get('q') ?? '';
	const { entries: players, error: findError } = await browsePlayers(supabase, { excludeIds: connectedIds, search });

	return {
		students: active,
		pending: pending.map((r) => ({ ...r, sentByMe: r.requested_by === user!.id })),
		findResults: players,
		findError,
		search
	};
};

export const actions: Actions = {
	request: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const playerId = fd.get('player_id') as string;
		if (!playerId) return fail(400, { error: 'No player selected' });

		const { error } = await sendRequest(supabase, { requesterId: user.id, requesterRole: 'coach', otherId: playerId });
		if (error) return fail(400, { error });
		return { success: true };
	},

	accept: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: true });
		if (error) return fail(400, { error });
		return { success: true };
	},

	decline: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await respondToRequest(supabase, { responderId: user.id, relationshipId, accept: false });
		if (error) return fail(400, { error });
		return { success: true };
	},

	unlink: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });
		const fd = await request.formData();
		const relationshipId = fd.get('relationship_id') as string;
		const { error } = await unlink(supabase, { userId: user.id, relationshipId });
		if (error) return fail(400, { error });
		return { success: true };
	}
};
