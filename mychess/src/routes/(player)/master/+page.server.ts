// mychess/src/routes/(player)/master/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { activeLevel } from '$lib/mastery/levels';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;

	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('player_id', user!.id),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color)')
			.eq('player_id', user!.id)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) {
		return { repertoires: [] };
	}

	const repIds = allReps.map((r: any) => r.id);
	const [{ data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds),
		supabase
			.from('variation_progress')
			.select('repertoire_id, variation_key, deepest_depth_reached')
			.eq('player_id', user!.id)
			.in('repertoire_id', repIds)
	]);

	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of (rawMoves ?? []) as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}

	const progressByRep = new Map<string, Map<string, number>>();
	for (const p of (progressRows ?? []) as any[]) {
		const map = progressByRep.get(p.repertoire_id) ?? new Map<string, number>();
		map.set(p.variation_key, p.deepest_depth_reached);
		progressByRep.set(p.repertoire_id, map);
	}

	const repertoires = allReps.map((r: any) => {
		const moves = movesByRep.get(r.id) ?? [];
		const variations = enumerateVariations(moves);
		const progressMap = progressByRep.get(r.id) ?? new Map<string, number>();
		const withProgress = variations.map((v) => ({
			...v,
			deepestReached: progressMap.get(v.variationKey) ?? 0
		}));
		return {
			id: r.id,
			name: r.name,
			color: r.color,
			level: activeLevel(withProgress),
			totalVariations: withProgress.length
		};
	});

	return { repertoires };
};
