// mychess/src/routes/api/repertoires/import-chapter/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { writeMoves } from '$lib/server/pgn-import';
import type { MoveRow } from '$lib/pgn-import';

function isMoveRow(value: unknown): value is MoveRow {
	if (!value || typeof value !== 'object') return false;
	const m = value as Record<string, unknown>;
	return (
		typeof m.fromFen === 'string' &&
		typeof m.toFen === 'string' &&
		typeof m.san === 'string' &&
		typeof m.move_number === 'number' &&
		typeof m.is_player_turn === 'boolean' &&
		(m.annotation === null || typeof m.annotation === 'string')
	);
}

/**
 * Creates one repertoire from one chapter's already-planned moves. Called
 * once per chapter from the client (see `PgnImportForm.svelte`) so a
 * multi-chapter PGN import can show real per-chapter progress instead of
 * one request silently doing everything before replying.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireApiUser(locals);

	const body = await request.json().catch(() => null);
	const { name, color, ecoCode, ecoName, moves } = body ?? {};

	if (typeof name !== 'string' || !name.trim()) throw error(400, 'name is required');
	if (color !== 'white' && color !== 'black') throw error(400, 'color must be "white" or "black"');
	if (ecoCode !== null && typeof ecoCode !== 'string') throw error(400, 'ecoCode must be a string or null');
	if (ecoName !== null && typeof ecoName !== 'string') throw error(400, 'ecoName must be a string or null');
	if (!Array.isArray(moves) || !moves.every(isMoveRow)) throw error(400, 'moves must be an array of move rows');

	const result = await writeMoves(locals.supabase, {
		playerId: user.id,
		name,
		color,
		ecoCode,
		ecoName,
		moves
	});
	if (result.error) throw error(400, result.error);

	return json({ repertoireId: result.repertoireId });
};
