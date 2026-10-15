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

// Both paths are built from `import.meta.dirname` and string literals below —
// no input reaches them, so security/detect-non-literal-fs-filename has nothing
// to protect against here.
const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations');
const RECALC = join(import.meta.dirname, 'recalc.ts');

// Strips SQL line and block comments, leaving string literals alone.
//
// Load-bearing, not tidiness: these migrations carry long explanatory headers,
// and 0075's quotes the statement `truncate public.badges cascade` in prose
// while explaining why NOT to let a push replay it. Matching that as if it were
// a real statement cleared the parsed catalog to empty — caught by the
// non-trivial-size assertion below, which is exactly what that assertion is for.
function stripComments(sql: string): string {
	let out = '';
	let inString = false;
	for (let i = 0; i < sql.length; i++) {
		const c = sql[i];
		if (inString) {
			out += c;
			// '' is an escaped quote inside a string, not the end of one.
			if (c === "'" && sql[i + 1] === "'") out += sql[++i];
			else if (c === "'") inString = false;
			continue;
		}
		if (c === "'") {
			inString = true;
			out += c;
		} else if (c === '-' && sql[i + 1] === '-') {
			while (i < sql.length && sql[i] !== '\n') i++;
			out += '\n';
		} else if (c === '/' && sql[i + 1] === '*') {
			i += 2;
			while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
			i++;
			out += ' ';
		} else {
			out += c;
		}
	}
	return out;
}

/** The catalog as the migrations leave it: truncates, inserts and deletes applied in order. */
function catalogIds(): Set<string> {
	const ids = new Set<string>();
	for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
		// eslint-disable-next-line security/detect-non-literal-fs-filename -- see the note above MIGRATIONS
		const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
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
