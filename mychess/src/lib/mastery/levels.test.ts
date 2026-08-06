// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, isSatisfied, currentLevel, activeLevel, levelCap } from './levels';

/**
 * Builds a variation-shaped object with `playerMoveCount` player moves,
 * alternating player/opponent steps starting on the player's move, with move
 * ids `${prefix}p1`, `${prefix}o1`, `${prefix}p2`, `${prefix}o2`, ...
 */
function variation(playerMoveCount: number, prefix: string) {
	const path: { moveId: string; isPlayerTurn: boolean }[] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, isPlayerTurn: false });
	}
	return { playerMoveCount, path };
}

describe('levelDepth', () => {
	it('is a uniform 3-move chunk per level, with no fixed ceiling', () => {
		expect(levelDepth(1)).toBe(3);
		expect(levelDepth(2)).toBe(6);
		expect(levelDepth(3)).toBe(9);
		expect(levelDepth(10)).toBe(30);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(6);
	});

	it("is the variation's own length when shorter than the level depth", () => {
		expect(targetDepth({ playerMoveCount: 2 }, 2)).toBe(2);
	});
});

describe('isSatisfied', () => {
	it('is satisfied when every player move up to the target depth is in the correct set', () => {
		const v = variation(4, 'v1-');
		const correct = new Set(['v1-p1', 'v1-p2', 'v1-p3']);
		expect(isSatisfied(v, 1, correct)).toBe(true); // target depth min(4,3) = 3
		expect(isSatisfied(v, 2, correct)).toBe(false); // target depth min(4,6) = 4, p4 missing
	});

	it('a naturally shorter variation is satisfied at every level once its own full length is correct', () => {
		const v = variation(2, 'short-');
		const correct = new Set(['short-p1', 'short-p2']);
		expect(isSatisfied(v, 1, correct)).toBe(true); // target = min(2,3) = 2
		expect(isSatisfied(v, 5, correct)).toBe(true); // target = min(2,15) = 2, still satisfied
	});

	it('a gap anywhere before the target depth breaks satisfaction, even deep into the line', () => {
		const v = variation(4, 'gap-');
		const correct = new Set(['gap-p1', 'gap-p3', 'gap-p4']); // p2 missing
		expect(isSatisfied(v, 2, correct)).toBe(false);
	});
});

describe('shared-prefix moves', () => {
	it('marking a shared prefix move correct satisfies every variation that shares it at that depth', () => {
		const sharedP1 = { moveId: 'shared-p1', isPlayerTurn: true };
		const va = { playerMoveCount: 1, path: [sharedP1] };
		const vb = { playerMoveCount: 1, path: [sharedP1] }; // a different variation sharing the same opening move edge
		const correct = new Set(['shared-p1']);
		expect(isSatisfied(va, 1, correct)).toBe(true);
		expect(isSatisfied(vb, 1, correct)).toBe(true);
	});
});

describe('currentLevel / activeLevel', () => {
	it('currentLevel is 0 and activeLevel is 1 when nothing has been played', () => {
		const v = variation(6, 'a-');
		expect(currentLevel([v], new Set())).toBe(0);
		expect(activeLevel([v], new Set())).toBe(1);
	});

	it('advances as moves are marked correct', () => {
		const v = variation(6, 'b-');
		const correct = new Set(['b-p1', 'b-p2', 'b-p3']);
		expect(currentLevel([v], correct)).toBe(1);
		expect(activeLevel([v], correct)).toBe(2);
	});

	it('is "mastered" once every variation\'s full length is covered', () => {
		const v = variation(4, 'c-');
		const correct = new Set(['c-p1', 'c-p2', 'c-p3', 'c-p4']);
		expect(activeLevel([v], correct)).toBe('mastered');
	});

	it('is "mastered" for an empty variation list', () => {
		expect(currentLevel([], new Set())).toBe(0);
		expect(activeLevel([], new Set())).toBe('mastered');
	});

	it('a satisfied short variation never blocks a longer one from progressing', () => {
		const short = variation(2, 'short2-');
		const long = variation(6, 'long2-');
		const correct = new Set([
			'short2-p1',
			'short2-p2',
			'long2-p1',
			'long2-p2',
			'long2-p3'
		]);
		expect(currentLevel([short, long], correct)).toBe(1);
		expect(activeLevel([short, long], correct)).toBe(2);
	});
});

describe('levelCap', () => {
	it('is 0 for an empty variation list', () => {
		expect(levelCap([])).toBe(0);
	});

	it('rounds up to the nearest 3-move chunk covering the longest variation', () => {
		expect(levelCap([variation(4, 'a-')])).toBe(2); // ceil(4/3) = 2
		expect(levelCap([variation(9, 'b-')])).toBe(3);
	});

	it('is driven by the longest variation among several', () => {
		expect(levelCap([variation(2, 'short-'), variation(7, 'long-')])).toBe(3); // ceil(7/3) = 3
	});
});
