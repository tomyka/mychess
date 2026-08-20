import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { createGame } from '$lib/server/games';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireApiUser(locals);
	const body = await request.json().catch(() => null);
	const { pgn, playedAs } = body ?? {};

	if (typeof pgn !== 'string' || !pgn.trim()) throw error(400, 'pgn is required');
	if (playedAs !== null && playedAs !== undefined && playedAs !== 'white' && playedAs !== 'black') {
		throw error(400, 'playedAs must be "white", "black", or null');
	}

	const result = await createGame(locals.supabase, user.id, pgn, playedAs ?? null);
	if ('error' in result) throw error(400, result.error);

	return json({ id: result.id });
};
