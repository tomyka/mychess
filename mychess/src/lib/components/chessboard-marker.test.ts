import { describe, it, expect } from 'vitest';
import { resolveDisplayMarker, shouldResnap } from './chessboard-marker';

describe('resolveDisplayMarker', () => {
	it('falls back to a star on correctSquare when marker is left undefined', () => {
		expect(resolveDisplayMarker(undefined, 'e4')).toEqual({ square: 'e4', kind: 'star' });
	});

	it('returns null when marker is undefined and there is no correctSquare', () => {
		expect(resolveDisplayMarker(undefined, null)).toBeNull();
	});

	it('uses the explicit marker when provided, ignoring correctSquare', () => {
		expect(resolveDisplayMarker({ square: 'd4', kind: 'cross' }, 'e4')).toEqual({
			square: 'd4',
			kind: 'cross'
		});
	});

	it('an explicit null marker suppresses the star entirely', () => {
		expect(resolveDisplayMarker(null, 'e4')).toBeNull();
	});
});

describe('shouldResnap', () => {
	it('resnaps when fen changed', () => {
		expect(shouldResnap('fenB', 'fenA', 0, 0)).toBe(true);
	});

	it('does not resnap when neither fen nor forceRevert changed', () => {
		expect(shouldResnap('fenA', 'fenA', 2, 2)).toBe(false);
	});

	it('resnaps when forceRevert was bumped even though fen is unchanged', () => {
		expect(shouldResnap('fenA', 'fenA', 3, 2)).toBe(true);
	});
});
