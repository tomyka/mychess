import { describe, it, expect, vi } from 'vitest';
import { recordAttemptStats } from './player-stats';

// GitHub issue #224. `player_stats` lost its only writer when migration 0027
// dropped `submit_session_result`, and eight badge rules kept reading the
// columns it used to move — so they checked a counter frozen at 0 forever.
// These pin the counting, which is the whole of the fix.
describe('recordAttemptStats', () => {
	type Upserted = Record<string, unknown>;

	function makeAdmin(existing: Upserted | null) {
		const upserts: Upserted[] = [];
		const rpcs: { fn: string; args: unknown }[] = [];
		const admin = {
			from: () => ({
				select: () => ({
					eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) })
				}),
				upsert: (row: Upserted) => {
					upserts.push(row);
					return Promise.resolve({ error: null });
				}
			}),
			rpc: (fn: string, args: unknown) => {
				rpcs.push({ fn, args });
				return Promise.resolve({ error: null });
			}
		} as never;
		return { admin, upserts, rpcs };
	}

	it('counts a clean attempt as both a review and a correct one', async () => {
		const { admin, upserts } = makeAdmin({ total_reviews: 4, total_correct: 3, moves_learned: 20 });

		await recordAttemptStats(admin, 'p1', { hadMistake: false, newlyMasteredMoves: 2 });

		expect(upserts).toHaveLength(1);
		expect(upserts[0]).toMatchObject({
			player_id: 'p1',
			total_reviews: 5,
			total_correct: 4,
			moves_learned: 22
		});
	});

	// `total_reviews` counts attempts MADE, not attempts passed — a player who is
	// struggling is exactly who should still see `review_10` move.
	it('still counts a mistaken attempt as a review, but not as a correct one', async () => {
		const { admin, upserts } = makeAdmin({ total_reviews: 4, total_correct: 3, moves_learned: 20 });

		await recordAttemptStats(admin, 'p1', { hadMistake: true, newlyMasteredMoves: 0 });

		expect(upserts[0]).toMatchObject({ total_reviews: 5, total_correct: 3, moves_learned: 20 });
	});

	// A missing row must not silently mean "this player earns no badges" — that
	// is the failure mode being fixed, so it must not be reintroduced for anyone
	// predating the onboarding helper that creates the row.
	it('starts from zero when the player has no stats row yet', async () => {
		const { admin, upserts } = makeAdmin(null);

		await recordAttemptStats(admin, 'p1', { hadMistake: false, newlyMasteredMoves: 3 });

		expect(upserts[0]).toMatchObject({ total_reviews: 1, total_correct: 1, moves_learned: 3 });
	});

	// `update_streak` survived both schema cleanups but has had no caller since
	// 0027, which is why `streak_days` is 0 for every player and the four streak
	// badges never fire either.
	it('pokes the streak so the streak badges can ever fire', async () => {
		const { admin, rpcs } = makeAdmin({ total_reviews: 0, total_correct: 0, moves_learned: 0 });

		await recordAttemptStats(admin, 'p1', { hadMistake: false, newlyMasteredMoves: 0 });

		expect(rpcs).toEqual([{ fn: 'update_streak', args: { p_player_id: 'p1' } }]);
	});

	it('does not write when the read fails, rather than resetting the counters to 1', async () => {
		const upserts: Upserted[] = [];
		const admin = {
			from: () => ({
				select: () => ({
					eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }) })
				}),
				upsert: (row: Upserted) => {
					upserts.push(row);
					return Promise.resolve({ error: null });
				}
			}),
			rpc: () => Promise.resolve({ error: null })
		} as never;
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await recordAttemptStats(admin, 'p1', { hadMistake: false, newlyMasteredMoves: 1 });
			// The point: a failed read leaves `current` null, and writing then would
			// clobber a real total with 1.
			expect(upserts).toHaveLength(0);
		} finally {
			spy.mockRestore();
		}
	});
});
