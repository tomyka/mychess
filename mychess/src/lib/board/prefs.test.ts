import { describe, it, expect } from 'vitest';
import {
	parseBoardPrefs,
	animationDuration,
	DEFAULT_PREFS,
	BOARD_THEMES,
	PIECE_SETS,
	ANIMATION_SPEEDS
} from './prefs';

describe('parseBoardPrefs', () => {
	it('returns defaults for an empty object', () => {
		expect(parseBoardPrefs({})).toEqual(DEFAULT_PREFS);
	});

	it('returns defaults for non-object input', () => {
		for (const bad of [null, undefined, 'x', 42, true, []]) {
			expect(parseBoardPrefs(bad)).toEqual(DEFAULT_PREFS);
		}
	});

	it('merges a valid partial object over defaults', () => {
		expect(parseBoardPrefs({ theme: 'green', coordinates: false })).toEqual({
			...DEFAULT_PREFS,
			theme: 'green',
			coordinates: false
		});
	});

	it('falls back per-key for unknown enum values', () => {
		const r = parseBoardPrefs({ theme: 'polkadot', pieceSet: 'nope', animation: 'warp' });
		expect(r.theme).toBe(DEFAULT_PREFS.theme);
		expect(r.pieceSet).toBe(DEFAULT_PREFS.pieceSet);
		expect(r.animation).toBe(DEFAULT_PREFS.animation);
	});

	it('falls back for non-boolean toggle values', () => {
		const r = parseBoardPrefs({ coordinates: 'yes', highlight: 1 });
		expect(r.coordinates).toBe(DEFAULT_PREFS.coordinates);
		expect(r.highlight).toBe(DEFAULT_PREFS.highlight);
	});

	it('accepts every catalog value as valid', () => {
		for (const t of BOARD_THEMES) expect(parseBoardPrefs({ theme: t.id }).theme).toBe(t.id);
		for (const p of PIECE_SETS) expect(parseBoardPrefs({ pieceSet: p.id }).pieceSet).toBe(p.id);
		for (const a of ANIMATION_SPEEDS)
			expect(parseBoardPrefs({ animation: a.id }).animation).toBe(a.id);
	});
});

describe('animationDuration', () => {
	it('maps speeds to milliseconds', () => {
		expect(animationDuration('off')).toBe(0);
		expect(animationDuration('subtle')).toBe(200);
		expect(animationDuration('snappy')).toBe(120);
	});
});
