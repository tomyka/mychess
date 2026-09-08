import { describe, it, expect } from 'vitest';
import { writeMoves } from './pgn-import';
import type { MoveRow } from '$lib/pgn-import';

type ExistingMoveRow = { from_position: string; san: string; chapter_names: string[] | null };
type UpsertedMoveRow = { from_position: string; san: string; chapter_names: string[] };

/**
 * A thenable query-builder fake. `writeMoves` chains
 * `.select().eq().in().order().range()` and awaits the builder itself, so
 * every method returns `this` and the terminal `await` resolves whatever
 * result the table handler was given.
 */
function builder(result: { data?: unknown; error?: { message: string } | null; count?: number }) {
	const self: Record<string, unknown> = {
		then: (resolve: (v: unknown) => unknown) =>
			resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count })
	};
	for (const method of ['select', 'eq', 'in', 'order', 'range', 'delete', 'update', 'single']) {
		self[method] = () => self;
	}
	return self;
}

/**
 * Fakes only what the append path of `writeMoves` touches: the `positions`
 * upsert/id lookup, the paginated `moves` read that finds edges an earlier
 * chapter already wrote, and the merge upsert itself. Called with
 * `existingRepertoireId` + `finalize: false`, which is exactly how
 * `/api/repertoires/import-chapter` writes every non-final chapter of a
 * multi-chapter PGN.
 */
function fakeSupabase(opts: { existingMoves?: ExistingMoveRow[]; movesUpsertError?: string } = {}) {
	const moveUpserts: UpsertedMoveRow[][] = [];
	const repertoireDeletes: string[] = [];

	const client = {
		from: (table: string) => {
			if (table === 'positions') {
				return {
					upsert: () => builder({ error: null }),
					// Every FEN maps to an id shaped `pos-<fen>`, so the assertions
					// below can name a `from_position` without threading real ids.
					select: () => ({
						in: (_col: string, fens: string[]) =>
							builder({ data: fens.map((fen) => ({ id: `pos-${fen}`, fen })) })
					})
				};
			}
			if (table === 'moves') {
				return {
					select: () => builder({ data: opts.existingMoves ?? [] }),
					upsert: (rows: UpsertedMoveRow[]) => {
						moveUpserts.push(rows);
						return builder({ error: opts.movesUpsertError ? { message: opts.movesUpsertError } : null });
					}
				};
			}
			if (table === 'repertoires') {
				return {
					delete: () => ({
						eq: (_col: string, id: string) => {
							repertoireDeletes.push(id);
							return builder({ error: null });
						}
					})
				};
			}
			throw new Error(`unexpected table ${table}`);
		}
	};

	return { client, moveUpserts, repertoireDeletes };
}

const move = (fromFen: string, toFen: string, san: string): MoveRow => ({
	fromFen,
	toFen,
	san,
	move_number: 1,
	is_player_turn: true,
	annotation: null
});

describe('writeMoves — coach writing a student-owned repertoire (GitHub issue #123)', () => {
	it('merges an earlier chapter’s name into a shared prefix edge instead of overwriting it', async () => {
		// `1. e4` already belongs to "Chapter One" from a previous call in the
		// same multi-chapter import; this call imports "Chapter Two", which
		// opens with the same edge. The shared edge must end up knowing about
		// BOTH chapters — `enumerateVariations` scopes its walk per chapter, so
		// an edge invisible to a chapter's own scope breaks that chapter's path
		// reconstruction.
		const { client, moveUpserts } = fakeSupabase({
			existingMoves: [{ from_position: 'pos-start', san: 'e4', chapter_names: ['Chapter One'] }]
		});

		const result = await writeMoves(client as never, {
			playerId: 'student-1',
			name: 'Repertoire — Chapter Two',
			color: 'white',
			ecoCode: null,
			ecoName: null,
			moves: [move('start', 'after-e4', 'e4'), move('after-e4', 'after-e4-e5', 'e5')],
			existingRepertoireId: 'rep-1',
			finalize: false,
			chapterLabel: 'Chapter Two'
		});

		expect(result.error).toBeNull();
		expect(result.repertoireId).toBe('rep-1');

		const upserted = moveUpserts.flat();
		const sharedEdge = upserted.find((r) => r.from_position === 'pos-start' && r.san === 'e4');
		expect(sharedEdge?.chapter_names).toEqual(['Chapter One', 'Chapter Two']);

		// An edge only this chapter uses carries just this chapter.
		const ownEdge = upserted.find((r) => r.from_position === 'pos-after-e4' && r.san === 'e5');
		expect(ownEdge?.chapter_names).toEqual(['Chapter Two']);
	});

	it('fails loudly when the merge upsert is refused, and leaves the existing repertoire alone', async () => {
		// The symptom of the missing `moves_coach_update_for_student` grant
		// (migration 0068): `moves` grants a coach INSERT on a student-owned
		// repertoire but not UPDATE, so `onConflict` upserting a shared edge is
		// refused. That must surface as an error — a swallowed failure here is
		// what leaves a chapter's lines unreconstructable.
		const { client, moveUpserts, repertoireDeletes } = fakeSupabase({
			existingMoves: [{ from_position: 'pos-start', san: 'e4', chapter_names: ['Chapter One'] }],
			movesUpsertError: 'new row violates row-level security policy for table "moves"'
		});

		const result = await writeMoves(client as never, {
			playerId: 'student-1',
			name: 'Repertoire — Chapter Two',
			color: 'white',
			ecoCode: null,
			ecoName: null,
			moves: [move('start', 'after-e4', 'e4')],
			existingRepertoireId: 'rep-1',
			finalize: false,
			chapterLabel: 'Chapter Two'
		});

		expect(result.repertoireId).toBeNull();
		expect(result.error).toMatch(/Failed to save moves/);
		expect(result.error).toMatch(/row-level security/);
		expect(moveUpserts).toHaveLength(1);
		// Append mode: the repertoire predates this call, so rolling it back is
		// the client's job across the whole batch, not this call's.
		expect(repertoireDeletes).toEqual([]);
	});

	it('carries a pre-existing name through even when this call has no chapter label', async () => {
		// A single-chapter import into an existing repertoire sends no
		// `chapterLabel`, so its own rows are untagged — but it must still not
		// wipe chapter names an earlier multi-chapter import put on a shared edge.
		const { client, moveUpserts } = fakeSupabase({
			existingMoves: [{ from_position: 'pos-start', san: 'e4', chapter_names: ['Chapter One'] }]
		});

		const result = await writeMoves(client as never, {
			playerId: 'student-1',
			name: 'Repertoire',
			color: 'white',
			ecoCode: null,
			ecoName: null,
			moves: [move('start', 'after-e4', 'e4')],
			existingRepertoireId: 'rep-1',
			finalize: false
		});

		expect(result.error).toBeNull();
		expect(moveUpserts.flat()[0]?.chapter_names).toEqual(['Chapter One']);
	});
});
