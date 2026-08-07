// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, taskKey, levelTaskVariations, levelCap } from './levels';

function variation(playerMoveCount: number, prefix: string) {
	const path: { moveId: string; isPlayerTurn: boolean }[] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, isPlayerTurn: false });
	}
	return { playerMoveCount, path };
}

describe('levelDepth', () => {
	it('is a uniform 2-move chunk per level, with no fixed ceiling', () => {
		expect(levelDepth(1)).toBe(2);
		expect(levelDepth(2)).toBe(4);
		expect(levelDepth(3)).toBe(6);
		expect(levelDepth(10)).toBe(20);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(4);
	});

	it("is the variation's own length when shorter than the level depth", () => {
		expect(targetDepth({ playerMoveCount: 2 }, 2)).toBe(2);
	});
});

describe('taskKey', () => {
	it('is the move id the target-depth prefix ends on', () => {
		const v = variation(4, 'v1-');
		expect(taskKey(v, 1)).toBe('v1-p2'); // depth 2 -> ends on the 2nd player move
		expect(taskKey(v, 2)).toBe('v1-p4'); // depth 4 -> ends on the 4th
	});

	it("falls back to the variation's own last move once its length caps the target", () => {
		const v = variation(2, 'short-');
		expect(taskKey(v, 5)).toBe('short-p2');
	});
});

describe('levelTaskVariations', () => {
	it('drops a variation once a strictly earlier level already fully covers it', () => {
		const short = variation(2, 'short-'); // fully covered by level 1 (depth 2)
		const long = variation(6, 'long-');
		expect(levelTaskVariations([short, long], 1).map((v) => v.playerMoveCount)).toEqual([2, 6]);
		expect(levelTaskVariations([short, long], 2)).toEqual([long]);
	});

	it('counts a variation exactly at a level boundary as ending there, not continuing', () => {
		const exact = variation(2, 'exact-'); // ends precisely at level 1's depth
		expect(levelTaskVariations([exact], 1)).toEqual([exact]);
		expect(levelTaskVariations([exact], 2)).toEqual([]);
	});

	it('collapses variations sharing an identical prefix at this level into one task', () => {
		const shared: { moveId: string; isPlayerTurn: boolean }[] = [];
		for (let i = 1; i <= 2; i++) {
			shared.push({ moveId: `s-p${i}`, isPlayerTurn: true });
			shared.push({ moveId: `s-o${i}`, isPlayerTurn: false });
		}
		const a = { playerMoveCount: 3, path: [...shared, { moveId: 'a-p3', isPlayerTurn: true }] };
		const b = { playerMoveCount: 3, path: [...shared, { moveId: 'b-p3', isPlayerTurn: true }] };
		expect(levelTaskVariations([a, b], 1).length).toBe(1); // identical through level 1's depth (2)
		expect(levelTaskVariations([a, b], 2).length).toBe(2); // diverge at move 3, level 2's depth
	});

	it("does not collapse variations that already differ within this level's own depth", () => {
		const a = variation(3, 'a-');
		const b = variation(3, 'b-');
		expect(levelTaskVariations([a, b], 1).length).toBe(2);
	});
});

describe('levelCap', () => {
	it('is 0 for an empty variation list', () => {
		expect(levelCap([])).toBe(0);
	});

	it('rounds up to the nearest 2-move chunk covering the longest variation', () => {
		expect(levelCap([variation(4, 'a-')])).toBe(2); // ceil(4/2) = 2
		expect(levelCap([variation(9, 'b-')])).toBe(5); // ceil(9/2) = 5
	});

	it('is driven by the longest variation among several', () => {
		expect(levelCap([variation(2, 'short-'), variation(7, 'long-')])).toBe(4); // ceil(7/2) = 4
	});
});
