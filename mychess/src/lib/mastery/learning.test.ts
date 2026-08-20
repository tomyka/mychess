import { describe, it, expect } from 'vitest';
import { splitQueues } from './learning';

describe('splitQueues', () => {
	const pool = [{ variationKey: 'a' }, { variationKey: 'b' }, { variationKey: 'c' }];

	it('sends learned variations to practice and the rest to learn', () => {
		const { learn, practice } = splitQueues(pool, new Set(['b']));
		expect(learn.map((v) => v.variationKey)).toEqual(['a', 'c']);
		expect(practice.map((v) => v.variationKey)).toEqual(['b']);
	});

	it('drops excluded variations from both queues', () => {
		const { learn, practice } = splitQueues(pool, new Set(['b']), new Set(['a', 'b']));
		expect(learn.map((v) => v.variationKey)).toEqual(['c']);
		expect(practice).toEqual([]);
	});

	it('preserves repertoire order in the learn queue, which the teaching progression depends on', () => {
		const { learn } = splitQueues(pool, new Set());
		expect(learn.map((v) => v.variationKey)).toEqual(['a', 'b', 'c']);
	});

	// Epic #95 success criterion 1, asserted directly rather than inferred from
	// how the two pages happen to behave.
	it('never places a variation in both queues, across every learned/excluded combination', () => {
		const keys = ['a', 'b', 'c'];
		for (let learnedMask = 0; learnedMask < 8; learnedMask++) {
			for (let excludedMask = 0; excludedMask < 8; excludedMask++) {
				const learned = new Set(keys.filter((_, i) => learnedMask & (1 << i)));
				const excluded = new Set(keys.filter((_, i) => excludedMask & (1 << i)));
				const { learn, practice } = splitQueues(pool, learned, excluded);
				const learnKeys = learn.map((v) => v.variationKey);
				const practiceKeys = practice.map((v) => v.variationKey);

				expect(learnKeys.filter((k) => practiceKeys.includes(k))).toEqual([]);
				// And nothing is silently lost: every variation is in one queue
				// or explicitly excluded.
				expect(new Set([...learnKeys, ...practiceKeys, ...excluded]).size).toBe(keys.length);
			}
		}
	});

	it('returns empty queues for an empty repertoire', () => {
		expect(splitQueues([], new Set())).toEqual({ learn: [], practice: [] });
	});
});
