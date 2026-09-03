// mychess/scripts/debug-learn-plan.ts
// One-off diagnostic (not part of the app): replicates
// src/routes/api/repertoires/[id]/learn-units/+server.ts's exact learn-plan
// derivation against real production data, using the REAL pure mastery
// functions imported via relative path (no `$lib` alias resolution outside
// SvelteKit's Vite context — see tests/global-setup.ts's own note on this),
// so `toRawMoveRows`/`fetchLiveMoves`'s query is duplicated inline instead of
// imported (both are already thin, direct DB-shape mappers with zero domain
// logic of their own).
//
// Prints each chapter's current band and its unlearned units, plus the
// per-variation teaching cap, so a "why am I being shown this line" report can
// be root-caused from data instead of guessed at (GitHub issues #180, #182).
//
//   npx tsx --env-file=.env scripts/debug-learn-plan.ts <repertoireId> <playerId>
import { enumerateVariations, filterVariations, moveSequenceLabel, type RawMoveRow, type Variation, type VariationStep } from '../src/lib/mastery/variations';
import { deriveLearnPlan } from '../src/lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '../src/lib/mastery/teaching';

const repertoireId = process.argv[2];
const playerId = process.argv[3];
if (!repertoireId || !playerId) {
	console.error('Usage: npx tsx --env-file=.env scripts/debug-learn-plan.ts <repertoireId> <playerId>');
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
	const allVariations: Variation[] = enumerateVariations(moves);

	// The app derives the plan over the PRACTICEABLE (exclusion-filtered) set,
	// so this must too — an excluded line produces no learn unit, and reporting
	// on the unfiltered set would show units the player never actually sees.
	const exclusionRows = await restAllPages<{ variation_key: string }>(
		`/rest/v1/variation_practice_exclusions?player_id=eq.${playerId}&repertoire_id=eq.${repertoireId}&select=variation_key`
	);
	const excludedVariationKeys = new Set(exclusionRows.map((r) => r.variation_key));
	const variations = filterVariations(allVariations, excludedVariationKeys);
	console.log(`Loaded ${moves.length} moves -> ${allVariations.length} variations (${excludedVariationKeys.size} excluded).`);

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
		console.log(`  solved key=${key} | ${owner ? owner.path.map((s: VariationStep) => s.san).join(' ') : '(no matching variation!)'}`);
	}
	for (const [key, p] of teachingProgress) {
		const owner = variations.find((v) => v.variationKey === key);
		const label = owner ? owner.path.map((s: VariationStep) => s.san).join(' ') : '(no matching variation!)';
		console.log(`  progress key=${key}  taught=${p.taughtPlies} mastered=${p.masteredPlies}  | ${label}`);
	}

	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const plan = deriveLearnPlan(variations, masteredMoveIds);
	console.log(`masteredMoveIds.size=${masteredMoveIds.size}  servable=${plan.servableVariationKeys.length}`);

	for (const state of plan.chapters) {
		const name = state.chapter ?? '(no chapters)';
		console.log(
			`\n== ${name}: band=${state.band ?? '-'} level=${state.level ?? '-'} complete=${state.complete} ${state.learnedInBand}/${state.totalInBand} ==`
		);
		for (const unit of state.units) {
			console.log(`  UNIT plies=${unit.path.length} rep=${unit.representativeVariationKey} members=${unit.variationKeys.length} | ${moveSequenceLabel(unit.path)}`);
		}
	}

	console.log('\n== per-variation teaching cap ==');
	for (const v of variations) {
		const cap = plan.ceilingPlyByVariationKey.get(v.variationKey);
		const solved = solvedKeys.has(v.variationKey);
		const progress = teachingProgress.get(v.variationKey);
		if (!solved && !progress && cap === v.path.length) continue; // untouched and uncapped — nothing to explain
		console.log(
			`[${solved ? 'SOLVED' : 'open  '}] plies=${v.path.length} cap=${cap ?? '-'} mastered=${progress?.masteredPlies ?? 0} | ${v.path.map((s: VariationStep) => s.san).join(' ')}`
		);
	}
}

main().catch((e) => {
	console.error('debug-learn-plan failed:', e);
	process.exit(1);
});
