import { describe, it, expect } from 'vitest';
import { load, actions } from './+page.server';

/**
 * GitHub issue #201's central silent-failure risk: every existing page test
 * for this route passes fixture objects directly, so dropping `opening_id`
 * from the `load` function's own select would leave all of them green while
 * every coach override silently stopped reaching the page.
 *
 * A stub that just echoes a fixed fixture back regardless of what was asked
 * for would be vacuous here — it can't tell a real select from a broken one.
 * So this one parses the PostgREST select string the same way real Supabase
 * would apply it: `.select('id, opening_id')` on a fixture row that ALSO has
 * `name` returns only `{ id, opening_id }`. That makes "drop opening_id from
 * the select" and "the test goes red" the same event.
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
		safeGetSession: async () => ({ user: { id: 'coach-1' }, session: {}, profile: {} }),
		supabase: {
			from: (table: string) => chain(tables[table] ?? { data: [], error: null })
		}
	} as any;
}

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
