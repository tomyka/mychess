import { describe, it, expect } from 'vitest';
import { classifyVariations, type ExistingLine, type IncomingLine } from './repertoire-diff';

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
