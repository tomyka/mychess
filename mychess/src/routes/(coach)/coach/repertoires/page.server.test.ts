import { describe, it, expect } from 'vitest';
import { load, actions } from './+page.server';

import { fakeLocals as makeLocals } from '$lib/testing/supabase-select-stub';

/** This suite's signed-in user; the stub itself honours the select list. */
const fakeLocals = (tables: Record<string, { data: unknown; error?: unknown }>) =>
	makeLocals(tables, 'coach-1');

describe('load', () => {
	it('carries opening_id through from the repertoires select to the page data', async () => {
		const locals = fakeLocals({
			repertoires: {
				data: [
					{
						id: 'rep-1',
						name: 'My Sicilian',
						color: 'white',
						eco_code: 'B22',
						eco_name: 'Alapin',
						opening_id: 'anti-sicilian-alapin-white',
						created_at: '2026-01-01T00:00:00Z'
					}
				],
				error: null
			}
		});

		// `load`'s declared return type includes `void` (SvelteKit's `Load`
		// signature allows it, even though this implementation never does) —
		// cast past that rather than threading an `if` through every assertion.
		const result = (await load({ locals } as any)) as any;

		expect(result.repertoires[0].opening_id).toBe('anti-sicilian-alapin-white');
	});
});

/**
 * GitHub issue #201's other integrity gap: `opening_id` has no foreign key,
 * so `actions.updateCuratedOpening` is the one place a bogus id could reach
 * the database. These pin the guard down at the boundary, rather than only
 * trusting that `resolveOpening` masks a bad value at render time.
 */
describe('actions.updateCuratedOpening', () => {
	function fakeRequest(fields: Record<string, string>) {
		const fd = new FormData();
		for (const [key, value] of Object.entries(fields)) fd.set(key, value);
		return { formData: async () => fd } as any;
	}

	it('rejects an opening_id that names no entry in the taxonomy', async () => {
		const locals = fakeLocals({});

		const result: any = await (actions.updateCuratedOpening as any)({
			request: fakeRequest({ rep_id: 'rep-1', opening_id: 'not-a-real-opening' }),
			locals
		});

		expect(result.status).toBe(400);
	});

	it('still clears the override to null when opening_id is empty (the picker\'s "Auto" choice)', async () => {
		const locals = fakeLocals({ repertoires: { data: null, error: null } });

		const result: any = await (actions.updateCuratedOpening as any)({
			request: fakeRequest({ rep_id: 'rep-1', opening_id: '' }),
			locals
		});

		expect(result).toEqual({ success: true });
	});

	it('accepts a real taxonomy entry id', async () => {
		const locals = fakeLocals({ repertoires: { data: null, error: null } });

		const result: any = await (actions.updateCuratedOpening as any)({
			request: fakeRequest({ rep_id: 'rep-1', opening_id: 'anti-sicilian-alapin-white' }),
			locals
		});

		expect(result).toEqual({ success: true });
	});
});
