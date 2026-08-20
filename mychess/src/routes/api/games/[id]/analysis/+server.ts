import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

function isAnalysisEntry(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.ply === 'number' &&
		!!e.score &&
		typeof e.score === 'object' &&
		typeof e.bestMoveSan === 'string' &&
		(e.classification === null || typeof e.classification === 'string')
	);
}

/**
 * Persists the full-game analysis a client just finished computing.
 * Ownership is checked before touching the body — a stray game id 404s
 * instead of failing generically on the write.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireApiUser(locals);

	const { data: owned } = await locals.supabase
		.from('games')
		.select('id, moves')
		.eq('id', params.id)
		.eq('player_id', user.id)
		.maybeSingle();
	if (!owned) throw error(404, 'Game not found');

	const body = await request.json().catch(() => null);
	const { analysis } = body ?? {};
	if (!Array.isArray(analysis) || !analysis.every(isAnalysisEntry)) {
		throw error(400, 'analysis must be an array of analysis entries');
	}
	if (analysis.length !== (owned.moves as unknown[]).length) {
		throw error(400, "analysis length must match the game's move count");
	}

	const { error: err } = await locals.supabase
		.from('games')
		.update({ analysis, analysis_status: 'done' })
		.eq('id', params.id)
		.eq('player_id', user.id);
	if (err) throw error(400, err.message);

	return json({ ok: true });
};
