// mychess/src/lib/server/practice-progress.test.ts
import { describe, it, expect } from 'vitest';
import { applyAttemptResult, touchVariationAttempt, loadVariationUpdatedAt } from './practice-progress';
import { UNTAGGED_CHAPTER, type Variation } from '$lib/mastery/variations';
import type { LearnPlan } from '$lib/mastery/learnUnits';

/**
 * A hand-built plan, pinning the contract `applyAttemptResult` actually
 * depends on — "credit this variation no further than this ply" — without
 * tying these tests to the real band boundaries (9/18/27). Note that the plan
 * `applyAttemptResult` uses to ADVANCE the active pointer afterwards is always
 * re-derived internally from post-write state; this one only caps the credit.
 */
function planFor(ceilingPlyByVariationKey: Record<string, number>, servableVariationKeys: string[]): LearnPlan {
	return { chapters: [], ceilingPlyByVariationKey: new Map(Object.entries(ceilingPlyByVariationKey)), servableVariationKeys };
}

function makeVariation(variationKey: string, plies: number): Variation {
	const path = Array.from({ length: plies }, (_, i) => ({
		moveId: `${variationKey}-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: Math.ceil(plies / 2), chapterNames: [] };
}

/** Two variations sharing the same leading 10 plies (5 player moves), each with its own 2-ply branch after. */
function makeSharedPrefixVariations(): { a: Variation; b: Variation } {
	const shared = Array.from({ length: 10 }, (_, i) => ({
		moveId: `shared-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	function branch(variationKey: string): Variation {
		const path = [
			...shared,
			{ moveId: `${variationKey}-p10`, san: 'M10', fromFen: 'f10a', toFen: 'f10b', isPlayerTurn: true },
			{ moveId: `${variationKey}-p11`, san: 'M11', fromFen: 'f10b', toFen: 'f11a', isPlayerTurn: false }
		];
		return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: 6, chapterNames: [] };
	}
	return { a: branch('a'), b: branch('b') };
}

function fakeSupabase(opts: {
	solvedKeys?: string[];
	teachingRows?: Array<{
		variation_key: string;
		taught_plies: number;
		mastered_plies: number;
	}>;
} = {}) {
	const solved = new Set(opts.solvedKeys ?? []);
	const teachingRows = opts.teachingRows ?? [];
	const fromCalls: string[] = [];
	const upsertCalls: Array<{ table: string; rows: any; options: any }> = [];

	// Both reads are paginated now (see `fetchAllPages`), so a read chain ends
	// in `.order(...).range(...)`. Every fixture here is far under one page, so
	// the exact-count lookup is never reached.
	const pagedRead = (data: () => any[]) => ({
		eq: () => ({
			eq: () => ({
				order: () => ({ range: () => Promise.resolve({ data: data(), error: null }) })
			})
		})
	});

	const client = {
		from: (table: string) => {
			fromCalls.push(table);
			if (table === 'variation_solved') {
				return {
					select: () => pagedRead(() => Array.from(solved).map((variation_key) => ({ variation_key }))),
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						solved.add((Array.isArray(rows) ? rows[0] : rows).variation_key);
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'variation_teaching_progress') {
				return {
					select: (columns: string) => {
						if (columns === 'updated_at') {
							// Single-row lookup path used by loadVariationUpdatedAt: each
							// .eq() narrows a running filter; .maybeSingle() resolves it.
							let filters: Record<string, string> = {};
							const node: any = {
								eq: (col: string, value: string) => {
									filters = { ...filters, [col]: value };
									return node;
								},
								maybeSingle: () =>
									Promise.resolve({
										data: teachingRows.find((r: any) => r.variation_key === filters.variation_key) ?? null,
										error: null
									})
							};
							return node;
						}
						return pagedRead(() => teachingRows);
					},
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'practice_active_variation') {
				return {
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'chapter_completed') {
				return {
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			throw new Error(`fakeSupabase: unexpected table ${table}`);
		}
	};

	return { client, fromCalls, upsertCalls };
}

describe('applyAttemptResult', () => {
	it('makes no reads or writes at all on a mistaken attempt', async () => {
		const { client, fromCalls, upsertCalls } = fakeSupabase();
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', true, [v1]);
		expect(fromCalls).toHaveLength(0);
		expect(upsertCalls).toHaveLength(0);
	});

	it('a clean teach-batch pass on a fresh variation advances taught_plies to the first batch only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// Ends right after the player's 3rd move (ply 4, player moves
				// first in this fixture), not a flat 6-ply offset.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 5, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('a clean non-final blind retest advances mastered_plies only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 20, mastered_plies: 20 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('records a resumed-after-break attempt against a zeroed floor, not the raw stored counters', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], true);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// Same shape as a genuinely fresh variation's first teach pass —
				// the raw 20/10 stored counters are ignored entirely because this
				// attempt was served reset to 0, so it must be recorded as if it
				// started from 0 too.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 5, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('a clean pass reaching the end of the path learns the variation immediately, and advances the active variation', async () => {
		// Story #104's two-pass, 20h-gap graduation rule was removed: one clean
		// pass through the whole variation is enough. `demoteVariation` (the
		// Practice pool) is the safety net now — a later mistake or hint sends
		// a shakily-learned line straight back to Learn.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 25,
			mastered_plies: 25
		});
		expect(upsertCalls[2].rows).toEqual(expect.objectContaining({ active_variation_key: 'v2' }));
	});

	it('bypasses teaching progress entirely for an already-solved variation (re-drill)', async () => {
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['v1'] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(true);
	});

	it('credits a fresh sibling variation for a shared prefix already solved via another variation, but still teaches its own tail first', async () => {
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['a'], teachingRows: [] });
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'b', false, [a, b]);
		// b's own path is only 2 plies past the shared 10, so its whole
		// remaining content is taught in one go — and mastered_plies starts at
		// 10 (credited from a), not 0. That still leaves b's own two plies shown
		// under an arrow and never yet recalled, so this pass advances
		// taught_plies alone; b is learned by the blind retest that follows.
		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'b',
			taught_plies: 12,
			mastered_plies: 10
		});
	});

	it('a clean LAST teach pass advances teaching only — the variation is solved by the blind retest after it', async () => {
		// 8 plies / 4 player moves: batch 1 is plies 0-4, batch 2 (plies 5-7)
		// the rest. That last batch reaches the path's end, but its moves have
		// only ever been shown under an arrow, so nothing is mastered yet.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 5 }]
		});
		const v1 = makeVariation('v1', 8);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 8,
			mastered_plies: 5
		});

		// The arrow-free replay that follows is what learns it.
		const second = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 8, mastered_plies: 5 }]
		});
		await applyAttemptResult(second.client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);
		expect(second.upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(second.upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 8,
			mastered_plies: 8
		});
	});

	it('a fresh SINGLE-batch variation still needs its blind retest before it is solved — a first teach pass never solves', async () => {
		// Nothing mastered yet, and one batch covers the whole 4-ply path: this
		// variation has never once been played without arrows, so it advances
		// taught_plies only and variation_solved stays untouched.
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 4, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	// The inverse of the behaviour this used to assert (GitHub issue #182): an
	// excluded variation is no longer passed in at all, and no longer caps the
	// chapter it was in. "I don't want to learn this line" now means exactly
	// that, where it used to mean "and nobody may finish this chapter either".
	it('caches a chapter as completed once every PRACTICEABLE variation in it is finished, ignoring excluded ones', async () => {
		// Only v1 is practiceable — /api/practice/attempt has already filtered
		// the excluded line out of the set it passes. Under the tier-ceiling
		// model the excluded line was passed separately and blocked this write
		// forever; now it simply isn't in scope.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);

		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation',
			'chapter_completed'
		]);
	});

	it('caches a chapter as completed once it reaches its own ceiling, without needing literal platinum', async () => {
		// v1 alone (silver tier), with no excluded sibling this time: once it's
		// solved, its chapter's own ceiling (silver — the highest tier it has
		// any content in) is reached, so it should be cached as completed even
		// though the chapter never reaches platinum.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);

		const cacheWrite = upsertCalls.find((c) => c.table === 'chapter_completed');
		expect(cacheWrite?.rows).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: UNTAGGED_CHAPTER }]);
	});

	it('evaluates chapter completion on a re-drill of an already-solved variation too, not just a fresh solve (GitHub issue #181)', async () => {
		// a is already solved. b, a sibling sharing a's first 5 player moves,
		// has independently reached the rest of its own tail via teaching
		// progress already on file — NOT through this attempt. Re-drilling a
		// (already solved, so no teaching progress advances for it at all)
		// must still correctly see b's own progress when deciding whether
		// their shared chapter is now complete — this is only possible if
		// progressMap is loaded unconditionally, not just on the
		// not-yet-solved branch this call never even enters.
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({
			solvedKeys: ['a'],
			teachingRows: [{ variation_key: 'b', taught_plies: 12, mastered_plies: 12 }] // b fully taught/mastered already, never solved
		});
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'a', false, [a, b]);

		// a re-drilled (bypasses teaching progress entirely) — no
		// variation_teaching_progress write for it.
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		// Both a (solved) and b (already fully mastered per its own stored
		// progress, even though never itself marked variation_solved) have
		// reached this chapter's own ceiling (bronze) -> now complete. Under
		// the OLD, solved-only algorithm this would NOT have completed, since
		// b was never in variation_solved.
		const cacheWrite = upsertCalls.find((c) => c.table === 'chapter_completed');
		expect(cacheWrite?.rows).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: UNTAGGED_CHAPTER }]);
	});

	it("uses a preloaded teaching-progress snapshot when the caller supplies one, instead of re-fetching (GitHub issue #181 — Task 8 review finding)", async () => {
		// teachingRows (what a FRESH loadTeachingProgress call would return)
		// is deliberately DIFFERENT from `preloaded` (what the caller already
		// has on hand) — if applyAttemptResult ignored the preloaded snapshot
		// and fetched fresh instead, it would advance from the fresh row's
		// counters (5/5, a mid-batch teach pass) instead of the preloaded
		// ones (25/20, one blind retest away from solved), producing an
		// observably different write.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 5 }]
		});
		const v1 = makeVariation('v1', 25);
		const preloaded = new Map([['v1', { taughtPlies: 25, masteredPlies: 20, updatedAt: null }]]);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], false, null, preloaded);

		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 25,
			mastered_plies: 25 // advanced from the PRELOADED 20 -> solved, not the fresh-fetch's 5
		});
		// v1 is a single-variation chapter that also fully solves here (same
		// shape as the "caches a chapter as completed" test above), so this
		// attempt also newly reaches that chapter's own ceiling.
		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation',
			'chapter_completed'
		]);
	});
});

describe('applyAttemptResult with a learn plan', () => {
	it('a clean pass that only finishes the served UNIT does NOT call markVariationSolved (no variation_solved upsert)', async () => {
		// v1 is 25 plies (13 player moves); its unit is capped at ply 7. Its
		// stored progress is already AT that cap going into this call, so this
		// pass's advanceTeachingProgress reports unitComplete: true, not solved.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 7, mastered_plies: 7 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], false, planFor({ v1: 7 }, ['v1']));

		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(false);
		// The line therefore never enters the Practice pool on this pass — the
		// unit leaves Learn, the variation stays unfinished.
		expect(upsertCalls.some((c) => c.table === 'chapter_completed')).toBe(false);
		// Progress is still saved (unchanged, since it was already at the cap)
		// even though the variation isn't solved.
		expect(upsertCalls.find((c) => c.table === 'variation_teaching_progress')?.rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 7,
			mastered_plies: 7
		});
	});

	it('a clean pass that finishes a unit STILL advances practice_active_variation to something else', async () => {
		// Same setup, plus a short untouched variation with a unit of its own.
		// Leaving the pointer on v1 would re-serve the same finished board
		// forever — this repo's central "stuck gauntlet" failure mode.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 7, mastered_plies: 7 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2], false, planFor({ v1: 7, v2: 4 }, ['v1', 'v2']));

		const activeWrite = upsertCalls.find((c) => c.table === 'practice_active_variation');
		expect(activeWrite?.rows).toEqual(expect.objectContaining({ active_variation_key: 'v2' }));
		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(false);
	});

	it('a clean pass that genuinely finishes a variation within its cap behaves exactly as with no plan: marks solved, advances', async () => {
		// v1's unit reaches its own true end (ply 25), so the cap never binds
		// and this must match the no-plan "reaching the end of the path"
		// behavior exactly: solved, and the active variation advances.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2], false, planFor({ v1: 25, v2: 4 }, ['v1', 'v2']));

		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 25,
			mastered_plies: 25
		});
		expect(upsertCalls[2].rows).toEqual(expect.objectContaining({ active_variation_key: 'v2' }));
	});

	it('a mistake stays a complete no-op regardless of the plan', async () => {
		const { client, fromCalls, upsertCalls } = fakeSupabase();
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', true, [v1], false, planFor({ v1: 7 }, ['v1']));
		expect(fromCalls).toHaveLength(0);
		expect(upsertCalls).toHaveLength(0);
	});

	it("teaches a shared-prefix sibling's own divergent move normally — nothing defers it any more (reverses GitHub issue #172)", async () => {
		// `a`/`b` share their first 10 plies and each add their own 2-ply
		// branch; both units are capped at ply 11 (the shared stretch plus each
		// line's own divergent move). `a` has already been taught to that cap.
		//
		// The tier-ceiling model treated `b` as a DEFERRED sibling here and
		// refused to credit its own 11th ply, on the grounds that the shared
		// stretch had already been "paid for". That deferral is gone: `b`'s own
		// divergent move is genuinely different content, and its unit is a
		// distinct prefix that has to be learned like any other. So this pass
		// teaches it (arrows -> taught_plies advances to the cap), with
		// mastered_plies still at the shared floor of 10 until the blind retest.
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'a', taught_plies: 11, mastered_plies: 11 }]
		});

		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'b', false, [a, b], false, planFor({ a: 11, b: 11 }, ['b']));

		const progressWrite = upsertCalls.find((c) => c.table === 'variation_teaching_progress');
		expect(progressWrite?.rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'b',
			taught_plies: 11,
			mastered_plies: 10
		});
		// A teach (arrowed) pass never solves and never finishes a unit.
		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
	});
});

describe('loadVariationUpdatedAt', () => {
	it('returns the row\'s updated_at, or null if no matching row exists', async () => {
		const { client } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 3, updated_at: '2026-08-17T11:00:00Z' } as any]
		});
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v1')).toBe('2026-08-17T11:00:00Z');
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v2')).toBeNull();
	});
});

describe('touchVariationAttempt', () => {
	it('upserts only updated_at, leaving taught_plies/mastered_plies out of the payload', async () => {
		const { client, upsertCalls } = fakeSupabase();
		await touchVariationAttempt(client as any, 'player-1', 'rep-1', 'v1');
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].table).toBe('variation_teaching_progress');
		expect(upsertCalls[0].options).toEqual({ onConflict: 'player_id,variation_key_hash' });
		// No taught_plies/mastered_plies in the payload: PostgREST's upsert only
		// updates columns actually present in the row on conflict, so omitting
		// them here is what keeps an existing row's real progress untouched.
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			updated_at: expect.any(String)
		});
	});
});
