// mychess/src/lib/server/practice-report.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	accuracyTrend,
	mistakeHotspots,
	activityStats,
	type AccuracyPoint,
	type Hotspot,
	type ActivityStats
} from '$lib/practice-report';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from '$lib/server/paginate';

export type RepertoireReport = { accuracy: AccuracyPoint[]; hotspots: Hotspot[]; activity: ActivityStats };

const HOTSPOT_LIMIT = 10;

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. Every practice move is logged now, so an
// active student can exceed 1000 move_attempts rows within a single 30-day
// window on their own. See `fetchAllPages` in ./paginate for the paging
// strategy itself.
const ATTEMPTS_PAGE_SIZE = MAX_ROWS_PAGE_SIZE;

/**
 * Fetches every move_attempts row matching a caller-supplied filter,
 * defeating the `max_rows` cap above. A thin wrapper fixing this module's
 * page size — see `fetchAllPages` for the contract both builders must honour
 * (fresh query per call; a deterministic `.order('id', ...)` on `buildQuery`).
 */
async function fetchAllMoveAttempts(buildQuery: () => any, buildCountQuery: () => any): Promise<any[]> {
	return fetchAllPages(buildQuery, buildCountQuery, ATTEMPTS_PAGE_SIZE);
}

/**
 * Loads and aggregates one player's move_attempts for one repertoire.
 * `sinceIso` null means all-time; otherwise only attempts at or after it are
 * included. `now` is passed through to `activityStats` for its streak calc.
 */
export async function loadRepertoireReport(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	sinceIso: string | null,
	now: Date
): Promise<RepertoireReport> {
	const buildQuery = () => {
		let q = supabase
			.from('move_attempts')
			.select('move_id, is_correct, created_at')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.order('id', { ascending: true });
		if (sinceIso) q = q.gte('created_at', sinceIso);
		return q;
	};
	const buildCountQuery = () => {
		let q = supabase
			.from('move_attempts')
			.select('id', { count: 'exact', head: true })
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId);
		if (sinceIso) q = q.gte('created_at', sinceIso);
		return q;
	};
	const data = await fetchAllMoveAttempts(buildQuery, buildCountQuery);

	const rows = (data ?? []).map((r: any) => ({
		moveId: r.move_id as string,
		isCorrect: r.is_correct as boolean,
		createdAt: r.created_at as string
	}));

	const rangeDays = sinceIso ? Math.round((now.getTime() - new Date(sinceIso).getTime()) / (24 * 60 * 60 * 1000)) : null;

	const distinctMoveIds = [...new Set(rows.map((r) => r.moveId))];
	const { data: moveRows } = distinctMoveIds.length
		? await supabase.from('moves').select('id, san, move_number').in('id', distinctMoveIds)
		: { data: [] as any[] };
	const labels = new Map((moveRows ?? []).map((m: any) => [m.id as string, { san: m.san as string, moveNumber: m.move_number as number }]));

	return {
		accuracy: accuracyTrend(rows, rangeDays),
		hotspots: mistakeHotspots(rows, labels, HOTSPOT_LIMIT),
		activity: activityStats(rows, now)
	};
}

export type StudentSummary = {
	accuracyPct: number | null;
	sessionCount: number;
	lastPracticedAt: string | null;
	avgSolvedPct: number | null;
};

/**
 * A roster-row summary for one student: accuracy/activity across ALL of
 * their move_attempts since `sinceIso` (matching how the existing
 * player_stats numbers on the student page are already global, not scoped
 * to this one coach's assignments), but `avgSolvedPct` averaged only across
 * repertoires THIS coach has assigned them (a repertoire this coach never
 * assigned isn't this coach's business) — each repertoire's own solved% is
 * `variation_solved` rows for that repertoire divided by its variation count,
 * then averaged evenly across repertoires (not weighted by size).
 */
export async function loadStudentSummary(
	supabase: SupabaseClient,
	coachId: string,
	playerId: string,
	sinceIso: string,
	now: Date
): Promise<StudentSummary> {
	const [{ data: assigned }, attemptRows] = await Promise.all([
		supabase.from('assigned_repertoires').select('repertoire_id').eq('coach_id', coachId).eq('player_id', playerId),
		fetchAllMoveAttempts(
			() =>
				supabase
					.from('move_attempts')
					.select('is_correct, created_at')
					.eq('player_id', playerId)
					.gte('created_at', sinceIso)
					.order('id', { ascending: true }),
			() =>
				supabase
					.from('move_attempts')
					.select('id', { count: 'exact', head: true })
					.eq('player_id', playerId)
					.gte('created_at', sinceIso)
		)
	]);

	const repertoireIds = (assigned ?? []).map((a: any) => a.repertoire_id as string);
	// The solved read is paginated (past the `max_rows` cap above): it spans
	// every repertoire this coach assigned the student, so its combined row
	// count exceeds 1000 well before any single repertoire does — and a
	// truncated read would silently understate `avgSolvedPct`. Kept inside the
	// `Promise.all` so it still runs concurrently with the repertoires lookup.
	const [{ data: repRows }, solvedRows] = repertoireIds.length
		? await Promise.all([
				supabase.from('repertoires').select('id, total_variations').in('id', repertoireIds),
				fetchAllPages<{ repertoire_id: string }>(
					() =>
						supabase
							.from('variation_solved')
							.select('repertoire_id')
							.eq('player_id', playerId)
							.in('repertoire_id', repertoireIds)
							.order('variation_key', { ascending: true }),
					() =>
						supabase
							.from('variation_solved')
							.select('id', { count: 'exact', head: true })
							.eq('player_id', playerId)
							.in('repertoire_id', repertoireIds),
					MAX_ROWS_PAGE_SIZE
				)
			])
		: [{ data: [] as any[] }, [] as any[]];

	const solvedCountByRep = new Map<string, number>();
	for (const r of (solvedRows ?? []) as any[]) {
		solvedCountByRep.set(r.repertoire_id, (solvedCountByRep.get(r.repertoire_id) ?? 0) + 1);
	}
	const solvedPcts = (repRows ?? [])
		.filter((r: any) => (r.total_variations ?? 0) > 0)
		.map((r: any) => ((solvedCountByRep.get(r.id) ?? 0) / r.total_variations) * 100);

	const rows = (attemptRows ?? []).map((r: any) => ({ isCorrect: r.is_correct as boolean, createdAt: r.created_at as string }));
	const total = rows.length;
	const correct = rows.filter((r) => r.isCorrect).length;
	const activity = activityStats(rows, now);

	return {
		accuracyPct: total > 0 ? Math.round((correct / total) * 100) : null,
		sessionCount: activity.sessionCount,
		lastPracticedAt: activity.lastPracticedAt,
		avgSolvedPct:
			solvedPcts.length > 0 ? Math.round(solvedPcts.reduce((s, p) => s + p, 0) / solvedPcts.length) : null
	};
}
