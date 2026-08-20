import { describe, it, expect } from 'vitest';
import {
	applyCleanPass,
	isPendingSecondPass,
	LEARN_GAP_MS,
	CLEAN_PASSES_TO_LEARN,
	type CleanPassState
} from './learning';

const T0 = new Date('2026-08-20T09:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

const fresh: CleanPassState = { cleanPassCount: 0, lastCleanPassAt: null };
const pending: CleanPassState = { cleanPassCount: 1, lastCleanPassAt: T0.toISOString() };

describe('applyCleanPass', () => {
	it('records the first clean pass without learning the variation', () => {
		const { next, learned } = applyCleanPass(fresh, T0);
		expect(learned).toBe(false);
		expect(next).toEqual({ cleanPassCount: 1, lastCleanPassAt: T0.toISOString() });
	});

	it('learns the variation on a second clean pass once the gap has elapsed', () => {
		const { next, learned } = applyCleanPass(pending, at(LEARN_GAP_MS));
		expect(learned).toBe(true);
		expect(next.cleanPassCount).toBe(CLEAN_PASSES_TO_LEARN);
		expect(next.lastCleanPassAt).toBe(at(LEARN_GAP_MS).toISOString());
	});

	// The load-bearing case. Sliding the timestamp forward on an early pass
	// would mean a player who practises hourly resets the clock every time and
	// never graduates, no matter how many clean passes they play.
	it('leaves BOTH the count and the original timestamp untouched when the gap has not elapsed', () => {
		const { next, learned } = applyCleanPass(pending, at(LEARN_GAP_MS - 1));
		expect(learned).toBe(false);
		expect(next).toEqual(pending);
	});

	it('holds at one pass across many early attempts, then graduates on the first qualifying one', () => {
		let state = fresh;
		for (const hoursIn of [0, 1, 2, 5, 11, 19]) {
			state = applyCleanPass(state, at(hoursIn * 60 * 60 * 1000)).next;
		}
		expect(state).toEqual({ cleanPassCount: 1, lastCleanPassAt: T0.toISOString() });

		const graduation = applyCleanPass(state, at(20 * 60 * 60 * 1000));
		expect(graduation.learned).toBe(true);
	});

	it('treats the boundary as inclusive: 19h59m is too soon, exactly 20h qualifies', () => {
		const justUnder = applyCleanPass(pending, at(LEARN_GAP_MS - 60_000));
		const exactly = applyCleanPass(pending, at(LEARN_GAP_MS));
		expect(justUnder.learned).toBe(false);
		expect(exactly.learned).toBe(true);
	});

	// A row that predates the migration has a count but no timestamp (or a
	// grandfathered row could be mid-flight). Without a timestamp there is no
	// gap to measure, so the safe reading is "start the clock now" rather than
	// either granting or denying learning off missing data.
	it('restarts the clock when a count exists but the timestamp is missing', () => {
		const { next, learned } = applyCleanPass({ cleanPassCount: 1, lastCleanPassAt: null }, T0);
		expect(learned).toBe(false);
		expect(next).toEqual({ cleanPassCount: 1, lastCleanPassAt: T0.toISOString() });
	});

	it('is idempotent on an already-learned count: a further pass cannot un-learn it', () => {
		const learnedState: CleanPassState = { cleanPassCount: 2, lastCleanPassAt: T0.toISOString() };
		const { next, learned } = applyCleanPass(learnedState, at(LEARN_GAP_MS * 3));
		expect(learned).toBe(true);
		expect(next.cleanPassCount).toBeGreaterThanOrEqual(CLEAN_PASSES_TO_LEARN);
	});

	it('never mutates the state it is given', () => {
		const input: CleanPassState = { cleanPassCount: 1, lastCleanPassAt: T0.toISOString() };
		applyCleanPass(input, at(LEARN_GAP_MS));
		expect(input).toEqual({ cleanPassCount: 1, lastCleanPassAt: T0.toISOString() });
	});
});

describe('isPendingSecondPass', () => {
	it('is pending with one clean pass and no learned marker', () => {
		expect(isPendingSecondPass(pending, false)).toBe(true);
	});

	it('is not pending before any clean pass', () => {
		expect(isPendingSecondPass(fresh, false)).toBe(false);
	});

	// Once learned, the variation belongs to Practice — pending is a
	// Learn-side state only, and treating a learned variation as pending would
	// put it in both queues at once (the invariant the epic exists to keep).
	it('is not pending once the variation is learned', () => {
		expect(isPendingSecondPass(pending, true)).toBe(false);
	});
});
