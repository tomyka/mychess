// mychess/src/lib/testing/supabase-select-stub.ts
//
// A Supabase stub for `+page.server.ts` tests that HONOURS THE SELECT LIST.
//
// The risk it exists for (GitHub issue #201, and the same shape recurs for
// every derived column since): a page test that passes fixture objects
// straight in cannot tell a correct select from a broken one. Drop
// `opening_id` — or `eco_code` — from a `load` function's own select and every
// such test stays green while the feature silently renders blank in
// production.
//
// A stub that echoes a fixed fixture back is therefore vacuous. This one
// parses the PostgREST select string the way real Supabase applies it:
// `.select('id, opening_id')` against a fixture row that ALSO has `name`
// returns only `{ id, opening_id }`. That makes "drop a column from the
// select" and "the test goes red" the same event.
//
// Test-only. Nothing in the app imports it, so it ships nowhere; it lives
// under `src/lib/` so both route test suites can reach it by `$lib` rather
// than by climbing out of their own directories.

type Field = { key: string; children?: Field[] };

/** Splits a PostgREST select list into fields, following embedded resources. */
export function parseSelect(select: string): Field[] {
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

/** Narrows a fixture row to the fields a select actually asked for. */
export function project(row: any, fields: Field[]): any {
	if (row == null) return row;
	const out: any = {};
	for (const { key, children } of fields) {
		if (!(key in row)) continue;
		const value = row[key];
		out[key] = children ? (Array.isArray(value) ? value.map((v: any) => project(v, children)) : project(value, children)) : value;
	}
	return out;
}

/** One table's query builder: records the select, projects on await. */
export function chain(result: { data: unknown; error?: unknown } = { data: [], error: null }): any {
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

/**
 * A `locals` whose `supabase.from()` serves the given fixtures through the
 * select-honouring chain above. `userId` is the signed-in user the page sees.
 */
export function fakeLocals(
	tables: Record<string, { data: unknown; error?: unknown }>,
	userId: string
) {
	return {
		safeGetSession: async () => ({ user: { id: userId }, session: {}, profile: {} }),
		supabase: {
			from: (table: string) => chain(tables[table] ?? { data: [], error: null })
		}
	} as any;
}
