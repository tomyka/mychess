// mychess/src/lib/practice-report.ts

export type MoveLabel = { san: string; moveNumber: number };
export type AccuracyPoint = { bucket: string; correct: number; wrong: number };
export type Hotspot = { moveId: string; label: string; missCount: number; attemptCount: number };
export type ActivityStats = { sessionCount: number; lastPracticedAt: string | null; streakDays: number };

/** The UTC calendar date ("YYYY-MM-DD") a timestamp falls on. */
function dateKey(iso: string): string {
	return iso.slice(0, 10);
}

/** The Monday (UTC) of the ISO week a "YYYY-MM-DD" date falls in. */
function weekStart(dateIso: string): string {
	const d = new Date(`${dateIso}T00:00:00Z`);
	const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
	const sinceMonday = day === 0 ? 6 : day - 1;
	d.setUTCDate(d.getUTCDate() - sinceMonday);
	return d.toISOString().slice(0, 10);
}

/**
 * Buckets attempts by day (`rangeDays` at or under 60) or by ISO week (wider
 * ranges, including "all time", where `rangeDays` is null) — an all-time
 * chart bucketed by day would need one bar per day since the player
 * started, unreadable well before it's useful. Buckets with zero attempts
 * are omitted — the chart only plots days/weeks the player actually
 * practiced, not a padded fixed-length range.
 */
export function accuracyTrend(rows: Array<{ isCorrect: boolean; createdAt: string }>, rangeDays: number | null): AccuracyPoint[] {
	const granularity = rangeDays !== null && rangeDays <= 60 ? 'day' : 'week';
	const buckets = new Map<string, { correct: number; wrong: number }>();
	for (const row of rows) {
		const day = dateKey(row.createdAt);
		const key = granularity === 'day' ? day : weekStart(day);
		const bucket = buckets.get(key) ?? { correct: 0, wrong: 0 };
		if (row.isCorrect) bucket.correct++;
		else bucket.wrong++;
		buckets.set(key, bucket);
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([bucket, counts]) => ({ bucket, ...counts }));
}

/** Formats a move as PGN-style notation, e.g. `6.Nf3` (white) or `6...e5` (black). `moveNumber` is a ply count (1 = white's 1st move, 2 = black's 1st move, ...). */
export function formatMoveLabel(moveNumber: number, san: string): string {
	const fullMove = Math.ceil(moveNumber / 2);
	const isWhite = moveNumber % 2 === 1;
	return `${fullMove}${isWhite ? '.' : '...'}${san}`;
}

/**
 * The top `limit` most-missed moves, ranked by wrong-attempt count descending;
 * ties break by total attempt count, then by `moveId` for a stable order.
 * Moves that were never missed are excluded entirely.
 *
 * Split out from `mistakeHotspots` so a caller can learn WHICH moves it needs
 * human-readable labels for before fetching any: the label lookup is a DB
 * query, and fetching one row per distinct move that merely *appears* in the
 * range scales with repertoire size, when only these `limit` are ever shown.
 * That also removed a latent `max_rows` truncation risk — an `.in(...)` over
 * every distinct move id would silently drop labels past PostgREST's 1000-row
 * cap for a large enough repertoire.
 */
export function rankMistakeHotspots(
	rows: Array<{ moveId: string; isCorrect: boolean }>,
	limit: number
): Array<{ moveId: string; missCount: number; attemptCount: number }> {
	const counts = new Map<string, { missCount: number; attemptCount: number }>();
	for (const row of rows) {
		const entry = counts.get(row.moveId) ?? { missCount: 0, attemptCount: 0 };
		entry.attemptCount++;
		if (!row.isCorrect) entry.missCount++;
		counts.set(row.moveId, entry);
	}

	return [...counts.entries()]
		.filter(([, c]) => c.missCount > 0)
		.sort(([aId, a], [bId, b]) => b.missCount - a.missCount || b.attemptCount - a.attemptCount || (aId < bId ? -1 : 1))
		.slice(0, limit)
		.map(([moveId, c]) => ({ moveId, missCount: c.missCount, attemptCount: c.attemptCount }));
}

/**
 * `rankMistakeHotspots` with each entry's human-readable label attached.
 * `labels` supplies the san/moveNumber for each `moveId` — one missing from it
 * (shouldn't happen; every attempt logs a real move) is skipped rather than
 * shown with a blank label. Callers that fetch labels lazily need only supply
 * labels for `rankMistakeHotspots(rows, limit)`'s own ids.
 */
export function mistakeHotspots(
	rows: Array<{ moveId: string; isCorrect: boolean }>,
	labels: Map<string, MoveLabel>,
	limit: number
): Hotspot[] {
	const hotspots: Hotspot[] = [];
	for (const { moveId, missCount, attemptCount } of rankMistakeHotspots(rows, limit)) {
		const label = labels.get(moveId);
		if (!label) continue;
		hotspots.push({ moveId, missCount, attemptCount, label: formatMoveLabel(label.moveNumber, label.san) });
	}
	return hotspots;
}

/**
 * Session/streak activity derived from attempt timestamps — a "session" is
 * approximated as one calendar day with at least one attempt (Practice has
 * no discrete session-start/end concept to draw on instead). The streak
 * anchors on today if the player has already practiced today, otherwise on
 * yesterday (so a streak doesn't read as broken just because today hasn't
 * happened yet). `now` is injected for testability, the same convention
 * used throughout `src/lib/mastery/` and `src/lib/server/practice-report.ts`.
 */
export function activityStats(rows: Array<{ createdAt: string }>, now: Date): ActivityStats {
	if (rows.length === 0) return { sessionCount: 0, lastPracticedAt: null, streakDays: 0 };

	const days = new Set(rows.map((r) => dateKey(r.createdAt)));
	const lastPracticedAt = rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), rows[0].createdAt);

	const cursor = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
	if (!days.has(cursor.toISOString().slice(0, 10))) {
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	let streakDays = 0;
	while (days.has(cursor.toISOString().slice(0, 10))) {
		streakDays++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}

	return { sessionCount: days.size, lastPracticedAt, streakDays };
}
