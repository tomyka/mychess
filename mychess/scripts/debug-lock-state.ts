// mychess/scripts/debug-lock-state.ts
// One-off diagnostic (not part of the app): replicates
// src/routes/api/repertoires/[id]/variations/+server.ts's exact locked-state
// computation against real production data, using the REAL pure mastery
// functions imported via relative path (no `$lib` alias resolution outside
// SvelteKit's Vite context — see tests/global-setup.ts's own note on this),
// so `toRawMoveRows`/`fetchLiveMoves`'s query is duplicated inline instead of
// imported (both are already thin, direct DB-shape mappers with zero domain
// logic of their own).
//
//   npx tsx --env-file=.env scripts/debug-lock-state.ts <repertoireId> <playerId>
import { enumerateVariations, type RawMoveRow, type Variation } from '../src/lib/mastery/variations';
import { teachingCeilingMoveCount, currentLevelProgress } from '../src/lib/mastery/chapterLevels';
import {
	computeMasteredMoveIds,
	computeMasteredPliesMap,
	isCeilingReachedAnywhere,
	isLockedForTier,
	isPausedAtCeiling,
	knownProgressFor,
	ceilingPlyFor
} from '../src/lib/mastery/teaching';

const repertoireId = process.argv[2];
const playerId = process.argv[3];
if (!repertoireId || !playerId) {
	console.error('Usage: npx tsx --env-file=.env scripts/debug-lock-state.ts <repertoireId> <playerId>');
	process.exit(1);
}

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

async function rest<T>(path: string): Promise<T> {
	const res = await fetch(`${SUPABASE_URL}${path}`, { headers });
	if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
}

// PostgREST enforces its own `max_rows` cap (1000 here — see supabase/config.toml)
// server-side regardless of a requested `limit`, so a single `rest()` call
// silently truncates a repertoire whose move count exceeds it — exactly the
// corruption `fetchLiveMoves`'s own doc comment warns about (a truncated move
// set shatters `enumerateVariations`'s tree into bogus fragments). Page with
// `offset` until a short page confirms the end, mirroring `fetchAllPages`.
async function restAllPages<T>(pathWithoutPaging: string, pageSize = 1000): Promise<T[]> {
	const all: T[] = [];
	for (let offset = 0; ; offset += pageSize) {
		const page = await rest<T[]>(`${pathWithoutPaging}&limit=${pageSize}&offset=${offset}`);
		all.push(...page);
		if (page.length < pageSize) break;
	}
	return all;
}

async function main() {
	const MOVE_SELECT_COLUMNS =
		'id,san,is_player_turn,from_position,to_position,chapter_names,from_pos:from_position(fen),to_pos:to_position(fen)';
	const rawMoves = await restAllPages<any>(
		`/rest/v1/moves?repertoire_id=eq.${repertoireId}&retired_at=is.null&select=${MOVE_SELECT_COLUMNS}&order=created_at.asc,import_order.asc,id.asc`
	);
	const moves: RawMoveRow[] = rawMoves.map((m) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? '',
		chapterNames: [...new Set<string>(m.chapter_names ?? [])]
	}));
	const variations: Variation[] = enumerateVariations(moves);
	console.log(`Loaded ${moves.length} moves -> ${variations.length} variations.`);

	const solvedRows = await restAllPages<{ variation_key: string }>(
		`/rest/v1/variation_solved?player_id=eq.${playerId}&repertoire_id=eq.${repertoireId}&select=variation_key`
	);
	const solvedKeys = new Set(solvedRows.map((r) => r.variation_key));

	const progressRows = await restAllPages<{ variation_key: string; taught_plies: number; mastered_plies: number; updated_at: string | null }>(
		`/rest/v1/variation_teaching_progress?player_id=eq.${playerId}&repertoire_id=eq.${repertoireId}&select=variation_key,taught_plies,mastered_plies,updated_at`
	);
	const teachingProgress = new Map(
		progressRows.map((r) => [r.variation_key, { taughtPlies: r.taught_plies, masteredPlies: r.mastered_plies, updatedAt: r.updated_at }])
	);

	console.log(`Solved: ${solvedKeys.size}. Progress rows: ${teachingProgress.size}.`);
	for (const key of solvedKeys) {
		const owner = variations.find((v) => v.variationKey === key);
		console.log(`  solved key=${key} | ${owner ? owner.path.map((s) => s.san).join(' ') : '(no matching variation!)'}`);
	}
	for (const [key, p] of teachingProgress) {
		const owner = variations.find((v) => v.variationKey === key);
		const label = owner ? owner.path.map((s) => s.san).join(' ') : '(no matching variation!)';
		console.log(`  progress key=${key}  taught=${p.taughtPlies} mastered=${p.masteredPlies}  | ${label}`);
	}

	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const masteredPliesMap = computeMasteredPliesMap(variations, teachingProgress, solvedKeys, masteredMoveIds);
	const ceilingMoveCount = teachingCeilingMoveCount(variations, masteredPliesMap);
	const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);
	const level = currentLevelProgress(variations, masteredPliesMap);
	console.log(
		`ceilingMoveCount=${ceilingMoveCount}  ceilingReached=${ceilingReached}  masteredMoveIds.size=${masteredMoveIds.size}  currentLevel=${level.tier} ${level.ready}/${level.total}`
	);

	for (const v of variations) {
		const solved = solvedKeys.has(v.variationKey);
		const { masteredPlies } = knownProgressFor({ variation: v, variations, teachingProgress, solvedKeys, resumedAfterBreak: false, masteredMoveIds });
		const locked = !solved && isLockedForTier(v.path, masteredPlies, ceilingMoveCount, ceilingReached);
		const pausedAtCeiling = isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount);
		const ceilingPly = ceilingPlyFor(v.path, ceilingMoveCount);
		if (locked || masteredPlies > 0 || solved) {
			const label = v.path.map((s) => s.san).join(' ');
			console.log(
				`[${solved ? 'SOLVED' : locked ? 'LOCKED' : 'open  '}] plies=${v.path.length} masteredPlies=${masteredPlies} ceilingPly=${ceilingPly} pausedAtCeiling=${pausedAtCeiling} | ${label}`
			);
		}
	}
}

main().catch((e) => {
	console.error('debug-lock-state failed:', e);
	process.exit(1);
});
