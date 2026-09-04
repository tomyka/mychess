// The badges catalog lives in the DB (`public.badges`, seeded and amended by
// migrations) while the grant rules live in `recalc.ts`. `(player)/badges` renders
// the CATALOG, so a row with no rule is shown to every player as a badge nobody
// can ever earn — which is how `streak_freeze_saved` survived until migration
// 0053, and how five Drill badges survived `be276f7` ("remove Master mode
// entirely") for far longer: their rules went, their catalog rows stayed.
//
// This reconciles the two sides by replaying the migrations, so the pairing is
// checked by `npm test` instead of by somebody noticing. Reading the .sql files
// is deliberate: the schema is the catalog's only definition, and a fixture
// listing the ids here would just be a third copy to drift.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations');
const RECALC = join(import.meta.dirname, 'recalc.ts');

/** The catalog as the migrations leave it: truncates, inserts and deletes applied in order. */
function catalogIds(): Set<string> {
	const ids = new Set<string>();
	for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
		const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
		if (/truncate\s+public\.badges/i.test(sql)) ids.clear();
		for (const block of sql.matchAll(/insert into public\.badges\s*\([^)]*\)\s*values(.*?);/gis)) {
			for (const row of block[1].matchAll(/^\s*\('([a-z0-9_]+)'/gm)) ids.add(row[1]);
		}
		for (const one of sql.matchAll(/delete from public\.badges[^;]*?where\s+id\s*=\s*'([a-z0-9_]+)'/gis)) {
			ids.delete(one[1]);
		}
		for (const many of sql.matchAll(/delete from public\.badges[^;]*?where[^;]*?id\s+in\s*\(([^)]*)\)/gis)) {
			for (const row of many[1].matchAll(/'([a-z0-9_]+)'/g)) ids.delete(row[1]);
		}
	}
	return ids;
}

/** Every id carrying a rule in recalc.ts's RULES table. */
function ruleIds(): Set<string> {
	const src = readFileSync(RECALC, 'utf8');
	return new Set([...src.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

describe('badge catalog and grant rules agree', () => {
	// Guards the parsing above: if a migration rename or reformat makes these
	// regexes silently match nothing, both sets go empty and the two assertions
	// below pass vacuously. This is what makes them mean something.
	it('parses a non-trivial catalog and rule set out of the real files', () => {
		expect(catalogIds().size).toBeGreaterThan(15);
		expect(ruleIds().size).toBeGreaterThan(15);
	});

	it('has no catalog row without a grant rule — those render as unearnable', () => {
		const orphans = [...catalogIds()].filter((id) => !ruleIds().has(id)).sort();
		expect(orphans).toEqual([]);
	});

	it('has no grant rule without a catalog row — those grant invisibly', () => {
		const invisible = [...ruleIds()].filter((id) => !catalogIds().has(id)).sort();
		expect(invisible).toEqual([]);
	});
});
