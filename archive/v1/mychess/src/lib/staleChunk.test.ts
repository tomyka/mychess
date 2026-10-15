import { describe, it, expect } from 'vitest';
import { isStaleChunkError, staleChunkAction } from './staleChunk';

describe('isStaleChunkError', () => {
	// The exact string production threw, from a tab running the previous build
	// after a redeploy — the case this whole module exists for.
	it('recognises the Chrome/Edge wording', () => {
		const error = new Error(
			'Failed to fetch dynamically imported module: https://mychesslt.vercel.app/_app/immutable/nodes/11.iACMe__D.js'
		);
		expect(isStaleChunkError(error)).toBe(true);
	});

	it('recognises the Firefox wording', () => {
		expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
	});

	it('recognises the Safari wording', () => {
		expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
	});

	it('does not claim ordinary application errors', () => {
		expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'variationKey')"))).toBe(false);
		expect(isStaleChunkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(false);
	});

	it('handles a thrown non-Error without crashing', () => {
		expect(isStaleChunkError('Failed to fetch dynamically imported module: /x.js')).toBe(true);
		expect(isStaleChunkError(null)).toBe(false);
		expect(isStaleChunkError(undefined)).toBe(false);
	});
});

describe('staleChunkAction', () => {
	const stale = new Error('Failed to fetch dynamically imported module: /_app/immutable/nodes/11.js');
	const other = new Error('something else went wrong');

	it('reloads a stale chunk the first time', () => {
		expect(staleChunkAction(stale, false)).toBe('reload');
	});

	it('reports instead of reloading again if a reload already happened', () => {
		// The bound that matters: a chunk still missing after a reload means
		// reloading cannot fix it, and looping would leave the user watching a
		// blank page flash with no way to read the error.
		expect(staleChunkAction(stale, true)).toBe('report');
	});

	it('never reloads for an unrelated error, reloaded or not', () => {
		expect(staleChunkAction(other, false)).toBe('report');
		expect(staleChunkAction(other, true)).toBe('report');
	});
});
