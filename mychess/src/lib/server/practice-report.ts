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

export type RepertoireReport = { accuracy: AccuracyPoint[]; hotspots: Hotspot[]; activity: ActivityStats };

const HOTSPOT_LIMIT = 10;

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
	let query = supabase
		.from('move_attempts')
		.select('move_id, is_correct, created_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
	if (sinceIso) query = query.gte('created_at', sinceIso);
	const { data } = await query;

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
	avgLevel: number | null;
};

/**
 * A roster-row summary for one student: accuracy/activity across ALL of
 * their move_attempts since `sinceIso` (matching how the existing
 * player_stats numbers on the student page are already global, not scoped
 * to this one coach's assignments), but mastery level averaged only across
 * repertoires THIS coach has assigned them (a level on a repertoire this
 * coach never assigned isn't this coach's business).
 */
export async function loadStudentSummary(
	supabase: SupabaseClient,
	coachId: string,
	playerId: string,
	sinceIso: string,
	now: Date
): Promise<StudentSummary> {
	const [{ data: assigned }, { data: attemptRows }] = await Promise.all([
		supabase.from('assigned_repertoires').select('repertoire_id').eq('coach_id', coachId).eq('player_id', playerId),
		supabase.from('move_attempts').select('is_correct, created_at').eq('player_id', playerId).gte('created_at', sinceIso)
	]);

	const repertoireIds = (assigned ?? []).map((a: any) => a.repertoire_id as string);
	const { data: levelRows } = repertoireIds.length
		? await supabase.from('level_progress').select('level').eq('player_id', playerId).in('repertoire_id', repertoireIds)
		: { data: [] as any[] };

	const rows = (attemptRows ?? []).map((r: any) => ({ isCorrect: r.is_correct as boolean, createdAt: r.created_at as string }));
	const total = rows.length;
	const correct = rows.filter((r) => r.isCorrect).length;
	const activity = activityStats(rows, now);
	const levels = (levelRows ?? []).map((r: any) => r.level as number);

	return {
		accuracyPct: total > 0 ? Math.round((correct / total) * 100) : null,
		sessionCount: activity.sessionCount,
		lastPracticedAt: activity.lastPracticedAt,
		avgLevel: levels.length > 0 ? Math.round((levels.reduce((s, l) => s + l, 0) / levels.length) * 10) / 10 : null
	};
}
