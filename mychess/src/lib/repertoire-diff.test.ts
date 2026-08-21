import { describe, it, expect } from 'vitest';
import {
	classifyVariations,
	type ExistingLine,
	type IncomingLine,
	detectRenames,
	RENAME_THRESHOLD
} from './repertoire-diff';

/** A line as the DB has it: move ids plus the SAN at each ply. */
function existing(ids: string[], sans: string[]): ExistingLine {
	return { variationKey: ids.join('>'), sans, chapterNames: [] };
}

/** A line as the upload has it: SAN only, no ids yet. */
function incoming(sans: string[]): IncomingLine {
	return { sans, chapterNames: [] };
}

const NAJDORF = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
const IDS = NAJDORF.map((_, i) => `m${i}`);

describe('classifyVariations', () => {
	it('marks an identical line unchanged and keeps its key', () => {
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(NAJDORF)]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('unchanged');
		expect(result[0].existingKey).toBe(IDS.join('>'));
	});

	it('marks a longer line extended, with the common prefix in plies', () => {
		const longer = [...NAJDORF, 'Be3', 'e5'];
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(longer)]);
		expect(result[0].kind).toBe('extended');
		expect(result[0].commonPlies).toBe(10);
	});

	it('marks a shorter line truncated', () => {
		const shorter = NAJDORF.slice(0, 8);
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(shorter)]);
		expect(result[0].kind).toBe('truncated');
		expect(result[0].commonPlies).toBe(8);
	});
});

describe('classifyVariations — divergence and new lines', () => {
	const BASE = [...NAJDORF, 'Be3', 'e5', 'Nf3', 'Qc7'];
	const BASE_IDS = BASE.map((_, i) => `m${i}`);

	it('marks a mid-line change diverged at the shared prefix', () => {
		// ...7.Nf3 Qc7 8.a4 becomes 8.Bd3 — diverges at ply 14.
		const before = [...BASE, 'a4'];
		const after = [...BASE, 'Bd3', 'Be7'];
		const result = classifyVariations([existing([...BASE_IDS, 'm14'], before)], [incoming(after)]);
		expect(result[0].kind).toBe('diverged');
		expect(result[0].commonPlies).toBe(14);
	});

	it('classifies a divergence on the OPPONENT ply, not just the player ply', () => {
		// White (the opponent, for a Black repertoire) plays 8.f3 instead of
		// 8.Nb3 — same arithmetic, but a naive "only count player moves"
		// implementation reports the wrong depth here.
		const before = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be6'];
		const after = [...NAJDORF, 'Be3', 'e5', 'f3', 'Be6'];
		const ids = before.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, before)], [incoming(after)]);
		expect(result[0].kind).toBe('diverged');
		expect(result[0].commonPlies).toBe(12);
	});

	it('gives a new sibling the inheritance depth of its shared prefix', () => {
		// 7...Be7 added beside the existing 7...Be6. The sibling shares 11
		// plies, so the student must not replay 1.e4 through 7.Nb3.
		const kept = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be6'];
		const sibling = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be7', 'Qd2'];
		const ids = kept.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, kept)], [incoming(kept), incoming(sibling)]);
		const newLine = result.find((r) => r.kind === 'new');
		expect(newLine).toBeDefined();
		expect(newLine!.commonPlies).toBe(13);
		expect(result.find((r) => r.kind === 'unchanged')).toBeDefined();
	});

	it('reports an existing line absent from the upload as removed', () => {
		const gone = [...NAJDORF, 'Be3', 'e6', 'Qd2', 'b5'];
		const kept = [...NAJDORF, 'Be3', 'e5'];
		const result = classifyVariations(
			[existing(gone.map((_, i) => `g${i}`), gone), existing(kept.map((_, i) => `k${i}`), kept)],
			[incoming(kept)]
		);
		const removed = result.filter((r) => r.kind === 'removed');
		expect(removed).toHaveLength(1);
		expect(removed[0].existingKey).toBe(gone.map((_, i) => `g${i}`).join('>'));
		expect(removed[0].sans).toBeNull();
	});

	it('does not report a line as removed when another line claimed it as its ancestor', () => {
		// The extended case: the old shorter line is not "removed", it grew.
		// Emitting both `extended` and `removed` for it would double-count and
		// retire moves the upload still uses.
		const before = [...NAJDORF, 'Be3', 'e5'];
		const after = [...before, 'Nb3', 'Be6'];
		const ids = before.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, before)], [incoming(after)]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('extended');
	});

	it('treats a line shared by two chapters as one line carrying both names', () => {
		// `enumerateVariations` merges by variationKey, so two chapters sharing
		// a tail are ONE variation carrying both chapter names — never two
		// lines with one key. The diff must preserve that.
		const shared = [...NAJDORF, 'Be3', 'e5'];
		const ids = shared.map((_, i) => `m${i}`);
		const result = classifyVariations(
			[{ variationKey: ids.join('>'), sans: shared, chapterNames: ['6.Bg5', '6.Be3'] }],
			[{ sans: shared, chapterNames: ['6.Bg5', '6.Be3'] }]
		);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('unchanged');
	});
});

describe('classifyVariations — one ancestor per existing line', () => {
	it('never emits two diffs for the same existing line', () => {
		// A coach keeps 7...Be6 and adds 7...Be7 beside it. Matching each
		// incoming line independently made the kept line BOTH unchanged and
		// diverged, and the diverged entry would demote every student who had
		// learned a line the coach never touched.
		const kept = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be6'];
		const sibling = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be7', 'Qd2'];
		const ids = kept.map((_, i) => `m${i}`);

		const result = classifyVariations([existing(ids, kept)], [incoming(kept), incoming(sibling)]);

		const keys = result.map((r) => r.existingKey).filter((k) => k !== null);
		expect(new Set(keys).size).toBe(keys.length);

		const forKept = result.filter((r) => r.existingKey === ids.join('>'));
		expect(forKept).toHaveLength(1);
		expect(forKept[0].kind).toBe('unchanged');
	});

	it('reports a second sibling as new rather than stealing a claimed ancestor', () => {
		const kept = [...NAJDORF, 'Be3', 'e5'];
		const siblingA = [...NAJDORF, 'Be3', 'Ng4'];
		const siblingB = [...NAJDORF, 'Be3', 'Nbd7'];
		const ids = kept.map((_, i) => `m${i}`);

		const result = classifyVariations([existing(ids, kept)], [incoming(kept), incoming(siblingA), incoming(siblingB)]);

		expect(result.filter((r) => r.kind === 'unchanged')).toHaveLength(1);
		expect(result.filter((r) => r.kind === 'new')).toHaveLength(2);
		expect(result.filter((r) => r.kind === 'removed')).toHaveLength(0);
		// Both siblings branch after NAJDORF + Be3 — 11 plies of shared knowledge.
		for (const n of result.filter((r) => r.kind === 'new')) expect(n.commonPlies).toBe(11);
	});
});

describe('detectRenames', () => {
	// n distinct lines, all sharing a 3-ply head so they look like real chapter
	// siblings rather than unrelated fragments.
	const lines = (n: number) => Array.from({ length: n }, (_, i) => ['e4', 'c5', 'Nf3', `x${i}`]);

	it('offers a rename when overlap is at or above the threshold', () => {
		// Six lines in the old chapter; five of them reappear under the new name.
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[{ name: 'Najdorf — Amsterdam Variation (6.f4)', lines: lines(5) }]
		);
		expect(result).toHaveLength(1);
		expect(result[0].from).toBe('Najdorf — 6.f4');
		expect(result[0].to).toBe('Najdorf — Amsterdam Variation (6.f4)');
		expect(result[0].overlap).toBeCloseTo(5 / 6);
	});

	it('offers nothing below the threshold rather than a bad guess', () => {
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[{ name: 'Something else', lines: lines(2) }]
		);
		expect(result).toEqual([]);
	});

	it('offers nothing when two new chapters both qualify', () => {
		// Ambiguous: the coach resolves it manually rather than being handed a
		// coin-flip presented as a default.
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[
				{ name: 'Amsterdam A', lines: lines(6) },
				{ name: 'Amsterdam B', lines: lines(6) }
			]
		);
		expect(result).toEqual([]);
	});

	it('never reports an overlap above 1 when the new chapter repeats a line', () => {
		// A duplicated line in the new chapter must not inflate the ratio past
		// 100% — overlap is "how much of the OLD chapter is covered", so it is
		// bounded by the old chapter's own distinct line count.
		const duplicated = [...lines(6), ...lines(6)];
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[{ name: 'Amsterdam', lines: duplicated }]
		);
		expect(result).toHaveLength(1);
		expect(result[0].overlap).toBe(1);
	});

	it('ignores an empty old chapter instead of dividing by zero', () => {
		const result = detectRenames([{ name: 'Empty', lines: [] }], [{ name: 'New', lines: lines(3) }]);
		expect(result).toEqual([]);
	});

	it('uses a threshold of 0.7', () => {
		expect(RENAME_THRESHOLD).toBe(0.7);
	});
});
