import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

/**
 * GitHub issue #201's central silent-failure risk: every existing page test
 * for this route passes fixture objects directly, so dropping `opening_id`
 * from either of this route's two `opening_id`-selecting queries (the
 * player's own repertoires, and the nested `repertoire:repertoire_id (...)`
 * for assigned ones) would leave all of them green while a coach override
 * silently stopped reaching the page. `$lib/testing/supabase-select-stub`
 * carries the mechanism and the reasoning behind it.
 *
 * `load` shares both tables with `loadRepertoireProgressSummaries`, which
 * queries `repertoires` and `assigned_repertoires` again under a different
 * select. Because each `.from(table)` call gets its own chain instance, the
 * two queries project the same fixture rows independently — this file's
 * fixtures carry both this page's fields and that function's shape-cache
 * fields so both projections succeed without mocking that module too.
 */
import { fakeLocals as makeLocals } from '$lib/testing/supabase-select-stub';

/** This suite's signed-in user; the stub itself honours the select list. */
const fakeLocals = (tables: Record<string, { data: unknown; error?: unknown }>) =>
	makeLocals(tables, 'player-1');

// `loadRepertoireProgressSummaries` reads these off the same rows, under a
// select that doesn't ask for `opening_id` — carried here so its query
// projects a complete-enough row and runs to completion.
const shapeCacheFields = {
	total_variations: 0,
	has_chapters: false,
	chapter_count: 0,
	moves_updated_at: null,
	update_in_progress_at: null
};

describe('load', () => {
	it('carries opening_id through both the own-repertoires and assigned-repertoires selects', async () => {
		const locals = fakeLocals({
			repertoires: {
				data: [
					{
						id: 'rep-own',
						name: 'My Alapin',
						color: 'white',
						eco_code: 'B22',
						eco_name: 'Alapin',
						opening_id: 'anti-sicilian-alapin-white',
						...shapeCacheFields
					}
				],
				error: null
			},
			assigned_repertoires: {
				data: [
					{
						repertoire: {
							id: 'rep-assigned',
							name: 'Najdorf Prep',
							color: 'black',
							eco_code: 'B90',
							eco_name: 'Najdorf',
							opening_id: 'sicilian-najdorf-black',
							...shapeCacheFields
						}
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
		expect(result.assignedRepertoires[0].opening_id).toBe('sicilian-najdorf-black');
	});
});
