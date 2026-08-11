// mychess/src/lib/practice-report.test.ts
import { describe, it, expect } from 'vitest';
import { accuracyTrend, mistakeHotspots, activityStats, formatMoveLabel } from './practice-report';

function row(moveId: string, isCorrect: boolean, createdAt: string) {
	return { moveId, isCorrect, createdAt };
}

describe('formatMoveLabel', () => {
	it('formats a white move as "N.san"', () => {
		expect(formatMoveLabel(11, 'Nf3')).toBe('6.Nf3');
	});

	it('formats a black move as "N...san"', () => {
		expect(formatMoveLabel(12, 'e5')).toBe('6...e5');
	});
});

describe('accuracyTrend', () => {
	it('buckets by day when rangeDays is at or under 60', () => {
		const rows = [
			row('m1', true, '2026-08-01T10:00:00Z'),
			row('m2', false, '2026-08-01T11:00:00Z'),
			row('m3', true, '2026-08-02T09:00:00Z')
		];
		expect(accuracyTrend(rows, 30)).toEqual([
			{ bucket: '2026-08-01', correct: 1, wrong: 1 },
			{ bucket: '2026-08-02', correct: 1, wrong: 0 }
		]);
	});

	it('buckets by ISO week (Monday start) when rangeDays exceeds 60 or is null (all-time)', () => {
		// 2026-08-01 is a Saturday and 2026-08-02 the following Sunday — both
		// fall in the week starting Monday 2026-07-27.
		const rows = [row('m1', true, '2026-08-01T10:00:00Z'), row('m2', true, '2026-08-02T09:00:00Z')];
		expect(accuracyTrend(rows, null)).toEqual([{ bucket: '2026-07-27', correct: 2, wrong: 0 }]);
	});

	it('does not merge dates across a week boundary', () => {
		// 2026-08-02 is a Sunday (end of the week starting 2026-07-27);
		// 2026-08-03 is the following Monday (start of the next week).
		const rows = [row('m1', true, '2026-08-02T09:00:00Z'), row('m2', true, '2026-08-03T09:00:00Z')];
		expect(accuracyTrend(rows, null)).toEqual([
			{ bucket: '2026-07-27', correct: 1, wrong: 0 },
			{ bucket: '2026-08-03', correct: 1, wrong: 0 }
		]);
	});

	it('returns an empty array for no rows', () => {
		expect(accuracyTrend([], 30)).toEqual([]);
	});
});

describe('mistakeHotspots', () => {
	const labels = new Map([
		['m1', { san: 'e5', moveNumber: 12 }],
		['m2', { san: 'Nf3', moveNumber: 11 }]
	]);

	it('ranks by miss count descending', () => {
		const rows = [
			row('m1', false, '2026-08-01T00:00:00Z'),
			row('m1', false, '2026-08-02T00:00:00Z'),
			row('m2', false, '2026-08-01T00:00:00Z')
		];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([
			{ moveId: 'm1', missCount: 2, attemptCount: 2, label: '6...e5' },
			{ moveId: 'm2', missCount: 1, attemptCount: 1, label: '6.Nf3' }
		]);
	});

	it('breaks a miss-count tie by attempt count, descending', () => {
		const rows = [
			row('m1', false, '2026-08-01T00:00:00Z'),
			row('m1', true, '2026-08-01T01:00:00Z'),
			row('m2', false, '2026-08-01T00:00:00Z')
		];
		// Both m1 and m2 have missCount 1, but m1 has attemptCount 2 vs m2's 1.
		expect(mistakeHotspots(rows, labels, 10)).toEqual([
			{ moveId: 'm1', missCount: 1, attemptCount: 2, label: '6...e5' },
			{ moveId: 'm2', missCount: 1, attemptCount: 1, label: '6.Nf3' }
		]);
	});

	it('breaks a miss-count and attempt-count tie by moveId, ascending', () => {
		const rows = [row('m2', false, '2026-08-01T00:00:00Z'), row('m1', false, '2026-08-01T00:00:00Z')];
		// Both m1 and m2 have missCount 1, attemptCount 1 — moveId 'm1' < 'm2'.
		expect(mistakeHotspots(rows, labels, 10)).toEqual([
			{ moveId: 'm1', missCount: 1, attemptCount: 1, label: '6...e5' },
			{ moveId: 'm2', missCount: 1, attemptCount: 1, label: '6.Nf3' }
		]);
	});

	it('excludes moves with zero misses (all-correct)', () => {
		const rows = [row('m2', true, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([]);
	});

	it('respects the limit', () => {
		const rows = [row('m1', false, '2026-08-01T00:00:00Z'), row('m2', false, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 1)).toHaveLength(1);
	});

	it('skips a moveId with no matching label instead of crashing', () => {
		const rows = [row('unknown', false, '2026-08-01T00:00:00Z')];
		expect(mistakeHotspots(rows, labels, 10)).toEqual([]);
	});
});

describe('activityStats', () => {
	it('returns zeroed stats for no rows', () => {
		expect(activityStats([], new Date('2026-08-11T12:00:00Z'))).toEqual({
			sessionCount: 0,
			lastPracticedAt: null,
			streakDays: 0
		});
	});

	it('counts distinct practiced days as sessions and finds the latest timestamp', () => {
		const rows = [
			row('m1', true, '2026-08-01T10:00:00Z'),
			row('m2', true, '2026-08-01T18:00:00Z'),
			row('m3', true, '2026-08-02T09:00:00Z')
		];
		const stats = activityStats(rows, new Date('2026-08-02T20:00:00Z'));
		expect(stats.sessionCount).toBe(2);
		expect(stats.lastPracticedAt).toBe('2026-08-02T09:00:00Z');
	});

	it('computes a streak of consecutive practiced days ending today', () => {
		const rows = [
			row('m1', true, '2026-08-08T10:00:00Z'),
			row('m2', true, '2026-08-09T10:00:00Z'),
			row('m3', true, '2026-08-10T10:00:00Z')
		];
		expect(activityStats(rows, new Date('2026-08-10T20:00:00Z')).streakDays).toBe(3);
	});

	it('still counts an active streak on a day not yet practiced, using yesterday as the anchor', () => {
		const rows = [row('m1', true, '2026-08-09T10:00:00Z'), row('m2', true, '2026-08-10T10:00:00Z')];
		expect(activityStats(rows, new Date('2026-08-11T08:00:00Z')).streakDays).toBe(2);
	});

	it('breaks the streak on a gap day', () => {
		const rows = [row('m1', true, '2026-08-05T10:00:00Z'), row('m2', true, '2026-08-10T10:00:00Z')];
		expect(activityStats(rows, new Date('2026-08-10T20:00:00Z')).streakDays).toBe(1);
	});
});
