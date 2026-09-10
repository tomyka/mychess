// mychess/scripts/backfill-active-openings.ts
//
// One-off (GitHub issue #202): applies the auto-activation rule retroactively —
// the OLDEST repertoire a player can see for a curated opening becomes their
// active preparation for it, unless they already have one.
//
// Ordering is explicit (assigned_at for assignments, created_at for a player's
// own uploads, both ascending) so the result does not depend on the order
// PostgREST happens to return rows in.
//
// Reads the taxonomy through the REAL resolveOpening via a relative import —
// `$lib` aliases do not resolve outside SvelteKit's Vite context, and its only
// non-relative import is `import type`, which tsx erases.
//
// Dry run by default; pass --apply to write.
//
//   npm run openings:backfill-active
//   npm run openings:backfill-active -- --apply
import { resolveOpening } from '../src/lib/openings/resolve';
import type { ResolvableRepertoire } from '../src/lib/openings/active';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run via npm run openings:backfill-active).');
	process.exit(1);
}

const apply = process.argv.includes('--apply');
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

// PostgREST caps an unbounded select at max_rows (1000 here) and truncates
// SILENTLY, so every read pages explicitly rather than trusting one call.
const PAGE = 1000;

async function fetchAll<T>(path: string): Promise<T[]> {
	const out: T[] = [];
	for (let offset = 0; ; offset += PAGE) {
		const url = `${SUPABASE_URL}${path}&limit=${PAGE}&offset=${offset}`;
		const res = await fetch(url, { headers });
		if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
		const page = (await res.json()) as T[];
		out.push(...page);
		if (page.length < PAGE) return out;
	}
}

type RepertoireRow = ResolvableRepertoire & { player_id: string; created_at: string };
type AssignmentRow = { player_id: string; repertoire_id: string; assigned_at: string };
type ActiveRow = { player_id: string; opening_id: string };

const repertoires = await fetchAll<RepertoireRow>(
	'/rest/v1/repertoires?select=id,player_id,eco_code,color,opening_id,created_at'
);
const assignments = await fetchAll<AssignmentRow>(
	'/rest/v1/assigned_repertoires?select=player_id,repertoire_id,assigned_at'
);
const existing = await fetchAll<ActiveRow>('/rest/v1/active_opening_repertoires?select=player_id,opening_id');

const repertoireById = new Map(repertoires.map((r) => [r.id, r]));

// Every (player, repertoire) pair the player can see, with the timestamp that
// decides which is oldest.
const candidates = [
	...repertoires.map((r) => ({ playerId: r.player_id, repertoireId: r.id, at: r.created_at })),
	...assignments.map((a) => ({ playerId: a.player_id, repertoireId: a.repertoire_id, at: a.assigned_at }))
].sort((a, b) => a.at.localeCompare(b.at));

const taken = new Set(existing.map((row) => `${row.player_id}::${row.opening_id}`));
const toWrite: { player_id: string; opening_id: string; repertoire_id: string }[] = [];

for (const candidate of candidates) {
	const repertoire = repertoireById.get(candidate.repertoireId);
	if (!repertoire) continue;
	const opening = resolveOpening(repertoire);
	if (!opening) continue;
	const key = `${candidate.playerId}::${opening.id}`;
	if (taken.has(key)) continue;
	taken.add(key);
	// set_by is left null on purpose: the backfill is not a person's choice.
	toWrite.push({ player_id: candidate.playerId, opening_id: opening.id, repertoire_id: candidate.repertoireId });
}

console.log(`${repertoires.length} repertoires, ${assignments.length} assignments, ${existing.length} already mapped.`);
console.log(`${toWrite.length} mappings to create.`);

if (!apply) {
	console.log('Dry run — pass --apply to write them.');
	process.exit(0);
}

for (let i = 0; i < toWrite.length; i += 500) {
	const chunk = toWrite.slice(i, i + 500);
	const res = await fetch(`${SUPABASE_URL}/rest/v1/active_opening_repertoires`, {
		method: 'POST',
		headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
		body: JSON.stringify(chunk)
	});
	if (!res.ok) throw new Error(`insert -> ${res.status}: ${await res.text()}`);
	console.log(`wrote ${Math.min(i + chunk.length, toWrite.length)}/${toWrite.length}`);
}

console.log('Done.');
