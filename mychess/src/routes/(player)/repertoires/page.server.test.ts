import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

/**
 * GitHub issue #201's central silent-failure risk: every existing page test
 * for this route passes fixture objects directly, so dropping `opening_id`
 * from either of this route's two `opening_id`-selecting queries (the
 * player's own repertoires, and the nested `repertoire:repertoire_id (...)`
 * for assigned ones) would leave all of them green while a coach override
 * silently stopped reaching the page.
 *
 * A stub that just echoes a fixed fixture back regardless of what was asked
 * for would be vacuous here — it can't tell a real select from a broken one.
 * So this one parses the PostgREST select string the same way real Supabase
 * would apply it: `.select('id, opening_id')` on a fixture row that ALSO has
 * `name` returns only `{ id, opening_id }`. That makes "drop opening_id from
 * the select" and "the test goes red" the same event.
 *
 * `load` shares both tables with `loadRepertoireProgressSummaries`, which
 * queries `repertoires` and `assigned_repertoires` again under a different
 * select. Because each `.from(table)` call gets its own chain instance, the
 * two queries project the same fixture rows independently — this file's
 * fixtures carry both this page's fields and that function's shape-cache
 * fields so both projections succeed without mocking that module too.
 */
type Field = { key: string; children?: Field[] };

function parseSelect(select: string): Field[] {
	const tokens: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of select) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (ch === ',' && depth === 0) {
			tokens.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim()) tokens.push(current);

	return tokens.map((token) => {
		const trimmed = token.trim();
		const parenIdx = trimmed.indexOf('(');
		const head = parenIdx === -1 ? trimmed : trimmed.slice(0, parenIdx);
		const key = (head.includes(':') ? head.split(':')[0] : head).trim();
		const childrenStr = parenIdx === -1 ? null : trimmed.slice(parenIdx + 1, trimmed.lastIndexOf(')'));
		return { key, children: childrenStr ? parseSelect(childrenStr) : undefined };
	});
}

function project(row: any, fields: Field[]): any {
	if (row == null) return row;
	const out: any = {};
	for (const { key, children } of fields) {
		if (!(key in row)) continue;
		const value = row[key];
		out[key] = children ? (Array.isArray(value) ? value.map((v: any) => project(v, children)) : project(value, children)) : value;
	}
	return out;
}

function chain(result: { data: unknown; error?: unknown } = { data: [], error: null }): any {
	let fields: Field[] | null = null;
	const handler: ProxyHandler<object> = {
		get(_target, prop) {
			if (prop === 'select') {
				return (columns: string) => {
					fields = parseSelect(columns);
					return proxy;
				};
			}
			if (prop === 'then') {
				return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
					const data = (result as any).data;
					const projected =
						fields && Array.isArray(data) ? { ...result, data: data.map((row: any) => project(row, fields!)) } : result;
					return Promise.resolve(projected).then(resolve, reject);
				};
			}
			return (..._args: unknown[]) => proxy;
		}
	};
	const proxy: any = new Proxy(() => {}, handler);
	return proxy;
}

function fakeLocals(tables: Record<string, { data: unknown; error?: unknown }>) {
	return {
		safeGetSession: async () => ({ user: { id: 'player-1' }, session: {}, profile: {} }),
		supabase: {
			from: (table: string) => chain(tables[table] ?? { data: [], error: null })
		}
	} as any;
}

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
