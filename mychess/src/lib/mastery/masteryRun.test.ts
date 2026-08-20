import { describe, it, expect } from 'vitest';
import { chapterMasteryView, masteryRunQueue } from './masteryRun';
import { UNTAGGED_CHAPTER } from './variations';

const v = (variationKey: string, chapterNames: string[] = []) => ({ variationKey, chapterNames });

const NOW = '2026-08-20T12:00:00.000Z';
const LATER = '2026-08-21T12:00:00.000Z';

describe('chapterMasteryView', () => {
	const variations = [v('a', ['Open']), v('b', ['Open']), v('c', ['Closed'])];

	it('reports per-chapter learned counts and run eligibility', () => {
		const view = chapterMasteryView({
			variations,
			learnedKeys: new Set(['a']),
			masteryRecords: [],
			repertoireMovesUpdatedAt: NOW
		});

		expect(view).toEqual([
			{ chapter: 'Open', total: 2, learned: 1, canRun: false, mastered: false },
			{ chapter: 'Closed', total: 1, learned: 0, canRun: false, mastered: false }
		]);
	});

	// A run drills learned variations, so a chapter with anything still un-learned
	// cannot be attempted — otherwise the exam would quiz material Learn hasn't
	// finished teaching.
	it('only allows a run once every variation in the chapter is learned', () => {
		const view = chapterMasteryView({
			variations,
			learnedKeys: new Set(['a', 'b']),
			masteryRecords: [],
			repertoireMovesUpdatedAt: NOW
		});
		expect(view.find((c) => c.chapter === 'Open')).toMatchObject({ canRun: true, learned: 2 });
		expect(view.find((c) => c.chapter === 'Closed')).toMatchObject({ canRun: false });
	});

	it('marks a chapter mastered while its record is current', () => {
		const view = chapterMasteryView({
			variations,
			learnedKeys: new Set(['a', 'b', 'c']),
			masteryRecords: [{ chapterName: 'Open', movesUpdatedAt: NOW }],
			repertoireMovesUpdatedAt: NOW
		});
		expect(view.find((c) => c.chapter === 'Open')).toMatchObject({ mastered: true, canRun: true });
		expect(view.find((c) => c.chapter === 'Closed')).toMatchObject({ mastered: false });
	});

	// The growth rule: the coach added material, so the repertoire's
	// moves_updated_at moved past what the record was earned against.
	it("un-masters a chapter whose record predates the repertoire's latest change", () => {
		const view = chapterMasteryView({
			variations,
			learnedKeys: new Set(['a', 'b', 'c']),
			masteryRecords: [{ chapterName: 'Open', movesUpdatedAt: NOW }],
			repertoireMovesUpdatedAt: LATER
		});
		expect(view.find((c) => c.chapter === 'Open')).toMatchObject({ mastered: false });
	});

	it('gives a wholly untagged repertoire one implicit chapter', () => {
		const view = chapterMasteryView({
			variations: [v('a'), v('b')],
			learnedKeys: new Set(['a', 'b']),
			masteryRecords: [],
			repertoireMovesUpdatedAt: NOW
		});
		expect(view).toEqual([{ chapter: UNTAGGED_CHAPTER, total: 2, learned: 2, canRun: true, mastered: false }]);
	});

	it('counts a line shared by two chapters in both', () => {
		const view = chapterMasteryView({
			variations: [v('a', ['Open', 'Closed'])],
			learnedKeys: new Set(['a']),
			masteryRecords: [],
			repertoireMovesUpdatedAt: NOW
		});
		expect(view).toEqual([
			{ chapter: 'Open', total: 1, learned: 1, canRun: true, mastered: false },
			{ chapter: 'Closed', total: 1, learned: 1, canRun: true, mastered: false }
		]);
	});

	it('has nothing to show for an empty repertoire', () => {
		expect(
			chapterMasteryView({
				variations: [],
				learnedKeys: new Set(),
				masteryRecords: [],
				repertoireMovesUpdatedAt: NOW
			})
		).toEqual([]);
	});
});

describe('masteryRunQueue', () => {
	const variations = [
		{ variationKey: 'a', chapterNames: ['Open'], path: [{ moveId: 'm1' }] },
		{ variationKey: 'b', chapterNames: ['Open'], path: [{ moveId: 'm2' }] },
		{ variationKey: 'c', chapterNames: ['Closed'], path: [{ moveId: 'm3' }] }
	];

	it('queues every learned variation in the chapter, in repertoire order', () => {
		const queue = masteryRunQueue(variations, 'Open', new Set(['a', 'b', 'c']));
		expect(queue.map((q) => q.variationKey)).toEqual(['a', 'b']);
	});

	it('is empty for a chapter with nothing learned, so the caller cannot start a run', () => {
		expect(masteryRunQueue(variations, 'Closed', new Set(['a', 'b']))).toEqual([]);
	});

	it('never includes an un-learned variation even when its chapter is otherwise ready', () => {
		const queue = masteryRunQueue(variations, 'Open', new Set(['a']));
		expect(queue.map((q) => q.variationKey)).toEqual(['a']);
	});
});
