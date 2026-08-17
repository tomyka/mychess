// mychess/src/lib/server/paginate.ts
//
// Supabase/PostgREST caps an unbounded `select` at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. Every read that can legitimately return
// more than `max_rows` rows must therefore page explicitly; this module holds
// the one shared implementation of that paging, rather than the copy of it
// that used to live in each caller.

/**
 * The page size to use unless a caller has a reason to differ: PostgREST's
 * own `max_rows` (supabase/config.toml), which is the largest page a single
 * request can return anyway.
 */
export const MAX_ROWS_PAGE_SIZE = 1000;

/**
 * The `.range()` boundaries needed to fetch the rest of a result set after
 * an already-fetched first page, given the true total row count. Pure and
 * separately tested so the off-by-one page math can be verified without a
 * real Supabase client.
 */
export function remainingPageRanges(totalCount: number, pageSize: number): Array<[number, number]> {
	const totalPages = Math.ceil(totalCount / pageSize);
	return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => {
		const page = i + 1;
		return [page * pageSize, page * pageSize + pageSize - 1] as [number, number];
	});
}

/**
 * Fetches every row matching a caller-supplied query, defeating the
 * `max_rows` cap described above. The common case (a result set fitting in
 * one page) costs exactly one round trip. A result set spanning multiple
 * pages costs one more (an exact-count lookup) plus a single round of every
 * remaining page fetched *concurrently* — rather than one round trip per page
 * fetched sequentially, which for a large result set (e.g. a multi-thousand-
 * move opening reference import) turned "open this page" into several seconds
 * of pure network latency.
 *
 * `buildQuery` and `buildCountQuery` must each build a fresh query on every
 * call (Supabase query builders are stateful/single-use), and `buildQuery`'s
 * query must carry a deterministic `.order(...)` clause — `.range` alone has
 * no defined traversal order to page through without it.
 *
 * Throws on any error (first page, count, or any remaining page); callers
 * that must not throw should wrap the call in try/catch.
 */
export async function fetchAllPages<T = any>(
	buildQuery: () => any,
	buildCountQuery: () => any,
	pageSize: number
): Promise<T[]> {
	const { data: firstPage, error: err } = await buildQuery().range(0, pageSize - 1);
	if (err) throw err;
	const firstRows: T[] = firstPage ?? [];
	if (firstRows.length < pageSize) return firstRows;

	const { count, error: countErr } = await buildCountQuery();
	if (countErr) throw countErr;

	const pages = await Promise.all(
		remainingPageRanges(count ?? firstRows.length, pageSize).map(([from, to]) => buildQuery().range(from, to))
	);
	for (const page of pages) {
		if (page.error) throw page.error;
	}

	return [...firstRows, ...pages.flatMap((p: any) => (p.data ?? []) as T[])];
}
