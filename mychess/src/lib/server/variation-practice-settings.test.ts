import { describe, it, expect } from 'vitest';
import { setVariationsIncluded, variationKeyHash } from './variation-practice-settings';
import { UNTAGGED_CHAPTER } from '$lib/mastery/variations';

type MoveRow = { id: string; chapter_names: string[] };
type ChapterExclusionRow = { player_id: string; repertoire_id: string; chapter_name: string; variation_key: string };
type FlatExclusionRow = { player_id: string; repertoire_id: string; variation_key: string };

/**
 * A stateful fake — not just a call recorder — because the write path now
 * reads its own prior writes back (`syncFlatExclusions` re-reads
 * `variation_chapter_practice_exclusions` after `setVariationsIncluded`'s own
 * per-chapter write), so a call-recording-only mock can't drive the sync
 * logic correctly.
 */
function fakeSupabase(
	opts: {
		moves?: MoveRow[];
		existingChapterExclusions?: ChapterExclusionRow[];
		existingFlatExclusions?: FlatExclusionRow[];
		chapterDeleteErrorOnCall?: number;
		chapterUpsertErrorOnCall?: number;
		errorMessage?: string;
	} = {}
) {
	const moves = opts.moves ?? [];
	const chapterExclusions = (opts.existingChapterExclusions ?? []).map((r) => ({ ...r }));
	const flatExclusions = (opts.existingFlatExclusions ?? []).map((r) => ({ ...r }));

	let chapterDeleteCallCount = 0;
	let chapterUpsertCallCount = 0;
	const chapterDeleteCalls: { playerId: string; chapter: string; hashes: string[] }[] = [];
	const chapterUpsertCalls: { rows: ChapterExclusionRow[]; options: unknown }[] = [];
	const flatDeleteCalls: { playerId: string; hashes: string[] }[] = [];
	const flatUpsertCalls: { rows: FlatExclusionRow[]; options: unknown }[] = [];

	const client = {
		from: (table: string) => {
			if (table === 'moves') {
				return {
					select: () => ({
						eq: () => ({
							in: (_col: string, ids: string[]) =>
								Promise.resolve({ data: moves.filter((m) => ids.includes(m.id)), error: null })
						})
					})
				};
			}
			if (table === 'variation_chapter_practice_exclusions') {
				return {
					select: () => ({
						eq: (_c: string, playerId: string) => ({
							in: (_c2: string, hashes: string[]) => {
								const rows = chapterExclusions.filter(
									(r) => r.player_id === playerId && hashes.includes(variationKeyHash(r.variation_key))
								);
								return Promise.resolve({
									data: rows.map((r) => ({ variation_key: r.variation_key, chapter_name: r.chapter_name })),
									error: null
								});
							}
						})
					}),
					delete: () => ({
						eq: (_c: string, playerId: string) => ({
							eq: (_c2: string, chapter: string) => ({
								in: (_c3: string, hashes: string[]) => {
									chapterDeleteCallCount++;
									chapterDeleteCalls.push({ playerId, chapter, hashes });
									if (opts.chapterDeleteErrorOnCall === chapterDeleteCallCount) {
										return Promise.resolve({ error: { message: opts.errorMessage ?? 'boom' } });
									}
									for (let i = chapterExclusions.length - 1; i >= 0; i--) {
										const r = chapterExclusions[i];
										if (r.player_id === playerId && r.chapter_name === chapter && hashes.includes(variationKeyHash(r.variation_key))) {
											chapterExclusions.splice(i, 1);
										}
									}
									return Promise.resolve({ error: null });
								}
							})
						})
					}),
					upsert: (rows: ChapterExclusionRow[], options: unknown) => {
						chapterUpsertCallCount++;
						chapterUpsertCalls.push({ rows, options });
						if (opts.chapterUpsertErrorOnCall === chapterUpsertCallCount) {
							return Promise.resolve({ error: { message: opts.errorMessage ?? 'boom' } });
						}
						for (const row of rows) {
							const idx = chapterExclusions.findIndex(
								(r) => r.player_id === row.player_id && r.chapter_name === row.chapter_name && r.variation_key === row.variation_key
							);
							if (idx >= 0) chapterExclusions[idx] = { ...row };
							else chapterExclusions.push({ ...row });
						}
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'variation_practice_exclusions') {
				return {
					delete: () => ({
						eq: (_c: string, playerId: string) => ({
							in: (_c2: string, hashes: string[]) => {
								flatDeleteCalls.push({ playerId, hashes });
								for (let i = flatExclusions.length - 1; i >= 0; i--) {
									if (flatExclusions[i].player_id === playerId && hashes.includes(variationKeyHash(flatExclusions[i].variation_key))) {
										flatExclusions.splice(i, 1);
									}
								}
								return Promise.resolve({ error: null });
							}
						})
					}),
					upsert: (rows: FlatExclusionRow[], options: unknown) => {
						flatUpsertCalls.push({ rows, options });
						for (const row of rows) {
							const idx = flatExclusions.findIndex((r) => r.player_id === row.player_id && r.variation_key === row.variation_key);
							if (idx >= 0) flatExclusions[idx] = { ...row };
							else flatExclusions.push({ ...row });
						}
						return Promise.resolve({ error: null });
					}
				};
			}
			throw new Error(`unexpected table ${table}`);
		}
	};

	return { client, chapterExclusions, flatExclusions, chapterDeleteCalls, chapterUpsertCalls, flatDeleteCalls, flatUpsertCalls };
}

// v1: Ruy Lopez only ('m1'). v2: shared by Ruy Lopez AND Italian Game ('m2',
// tagged with both — every edge along v2's one-move path carries both names,
// so the intersection is both). v3: untagged ('m3', no chapter_names).
const MOVES: MoveRow[] = [
	{ id: 'm1', chapter_names: ['Ruy Lopez'] },
	{ id: 'm2', chapter_names: ['Ruy Lopez', 'Italian Game'] },
	{ id: 'm3', chapter_names: [] }
];

describe('setVariationsIncluded', () => {
	it('no-ops on an empty variationKeys array without touching supabase at all', async () => {
		const { client, chapterDeleteCalls, chapterUpsertCalls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', [], true, 'Ruy Lopez');
		expect(result).toEqual({ error: null });
		expect(chapterDeleteCalls).toHaveLength(0);
		expect(chapterUpsertCalls).toHaveLength(0);
	});

	it('excludes a line under one chapter only, leaving its OWN entry under a sibling chapter untouched — the actual bug (#86)', async () => {
		const { client, chapterExclusions, flatExclusions } = fakeSupabase({
			moves: MOVES,
			// v2 is already excluded under Italian Game (its other chapter).
			existingChapterExclusions: [{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: 'Italian Game', variation_key: 'm2' }]
		});
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m2'], false, 'Ruy Lopez');
		expect(result).toEqual({ error: null });

		// Now excluded under BOTH chapters independently — Ruy Lopez's own new
		// row, Italian Game's pre-existing one, both present.
		expect(chapterExclusions).toContainEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			chapter_name: 'Ruy Lopez',
			variation_key: 'm2'
		});
		expect(chapterExclusions).toContainEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			chapter_name: 'Italian Game',
			variation_key: 'm2'
		});

		// Excluded under every real chapter it belongs to -> truly excluded ->
		// mirrored into the flat table.
		expect(flatExclusions).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'm2' }]);
	});

	it('a line excluded under only SOME of its chapters stays included in the flat (practiceable) table', async () => {
		const { client, flatExclusions } = fakeSupabase({ moves: MOVES });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m2'], false, 'Ruy Lopez');
		expect(result).toEqual({ error: null });
		// Only excluded under Ruy Lopez; Italian Game still includes it, so it
		// stays in the practice pool.
		expect(flatExclusions).toEqual([]);
	});

	it('re-including a line under one chapter restores the flat table once no chapter excludes it anymore', async () => {
		const { client, chapterExclusions, flatExclusions } = fakeSupabase({
			moves: MOVES,
			existingChapterExclusions: [
				{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: 'Ruy Lopez', variation_key: 'm2' },
				{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: 'Italian Game', variation_key: 'm2' }
			],
			existingFlatExclusions: [{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'm2' }]
		});
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m2'], true, 'Italian Game');
		expect(result).toEqual({ error: null });

		// Italian Game's own row is gone; Ruy Lopez's own row (untouched) survives.
		expect(chapterExclusions).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: 'Ruy Lopez', variation_key: 'm2' }
		]);
		// No longer excluded under every chapter -> back in the practice pool.
		expect(flatExclusions).toEqual([]);
	});

	it('the repertoire-level scope (chapter: null) excludes a shared line under EVERY real chapter it belongs to, in one call', async () => {
		const { client, chapterExclusions, flatExclusions } = fakeSupabase({ moves: MOVES });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m2'], false, null);
		expect(result).toEqual({ error: null });
		expect(chapterExclusions.map((r) => r.chapter_name).sort()).toEqual(['Italian Game', 'Ruy Lopez']);
		expect(flatExclusions).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'm2' }]);
	});

	it('resolves a genuinely untagged line to the UNTAGGED_CHAPTER bucket', async () => {
		const { client, chapterExclusions } = fakeSupabase({ moves: MOVES });
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m3'], false, null);
		expect(chapterExclusions).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: UNTAGGED_CHAPTER, variation_key: 'm3' }
		]);
	});

	it('a chapter-scoped write (not null) never touches a key it was not given, even under the same chapter', async () => {
		const { client, chapterUpsertCalls } = fakeSupabase({ moves: MOVES });
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m1'], false, 'Ruy Lopez');
		expect(chapterUpsertCalls.flatMap((c) => c.rows.map((r) => r.variation_key))).toEqual(['m1']);
	});

	it('propagates a per-chapter delete error message', async () => {
		const { client } = fakeSupabase({ moves: MOVES, chapterDeleteErrorOnCall: 1, errorMessage: 'boom' });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m1'], true, 'Ruy Lopez');
		expect(result).toEqual({ error: 'boom' });
	});

	it('propagates a per-chapter upsert error message', async () => {
		const { client } = fakeSupabase({ moves: MOVES, chapterUpsertErrorOnCall: 1, errorMessage: 'boom' });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m1'], false, 'Ruy Lopez');
		expect(result).toEqual({ error: 'boom' });
	});

	it('rolls back an earlier successful per-chapter upsert batch when a later batch fails', async () => {
		// Two chapters -> two upsert groups (one per chapter) when chapter is
		// null; the second group's failure must roll back the first group's
		// already-committed insert.
		const { client, chapterExclusions } = fakeSupabase({ moves: MOVES, chapterUpsertErrorOnCall: 2, errorMessage: 'batch 2 failed' });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m2'], false, null);
		expect(result).toEqual({ error: 'batch 2 failed' });
		// Whichever chapter group committed first was rolled back — nothing survives.
		expect(chapterExclusions).toEqual([]);
	});

	it('batches a large per-chapter delete into multiple calls of at most 100 keys each', async () => {
		const manyMoves = Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, chapter_names: ['Ruy Lopez'] }));
		const { client, chapterDeleteCalls } = fakeSupabase({ moves: manyMoves });
		const keys = manyMoves.map((m) => m.id);
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, true, 'Ruy Lopez');
		expect(result).toEqual({ error: null });
		expect(chapterDeleteCalls).toHaveLength(3); // 100 + 100 + 50
		expect(chapterDeleteCalls[0].hashes).toHaveLength(100);
		expect(chapterDeleteCalls[2].hashes).toHaveLength(50);
	});

	it('dedupes variationKeys before upserting, so a repeated key does not appear twice', async () => {
		const { client, chapterUpsertCalls } = fakeSupabase({ moves: MOVES });
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m1', 'm1'], false, 'Ruy Lopez');
		expect(chapterUpsertCalls.flatMap((c) => c.rows.map((r) => r.variation_key))).toEqual(['m1']);
	});

	it('propagates an error when the moves lookup itself fails', async () => {
		const client = {
			from: (table: string) => {
				if (table === 'moves') {
					return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'moves lookup failed' } }) }) }) };
				}
				throw new Error(`unexpected table ${table}`);
			}
		};
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['m1'], true, 'Ruy Lopez');
		expect(result).toEqual({ error: 'moves lookup failed' });
	});
});
