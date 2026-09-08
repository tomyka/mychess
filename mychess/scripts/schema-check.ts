// Read-only check that a migration actually took effect. CLAUDE.md is explicit
// that a migration must never be assumed applied — there is no linked Supabase
// CLI here, so the user runs the SQL by hand and this confirms the result.
//
//   npm run schema:check
//
// Add a probe per migration as new ones land; a probe is just "select these
// columns, limit 1" and passes only if PostgREST accepts them.

import { readdirSync, readFileSync } from 'node:fs';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via `npm run schema:check`)');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

// `absent: true` inverts a probe: it passes only if the table is GONE — the
// only way a `drop table` migration is observable through PostgREST.
const PROBES: { migration: string; table: string; select: string; absent?: boolean }[] = [
  { migration: '0057', table: 'variation_teaching_progress', select: 'clean_pass_count,last_clean_pass_at' },
  { migration: '0057', table: 'variation_demotions', select: 'id,player_id,variation_key,cause,demoted_at' },
  // 0059 widens a CHECK constraint, which a select can't observe — but the
  // column list is still worth pinning, because `sessions` was silently
  // unwritable for months: both writers sent `cards_reviewed`, a column that
  // has never existed in any migration (the real one is `cards_done`), and
  // neither checked the resulting error. See #103.
  { migration: '0059', table: 'sessions', select: 'id,player_id,repertoire_id,mode,cards_done,started_at' },
  { migration: '0060', table: 'badges', select: 'id,name,description' },
  { migration: '0069', table: 'repertoires', select: 'id,chapter_count' },
  { migration: '0070', table: 'variation_chapter_practice_exclusions', select: 'id,player_id,repertoire_id,chapter_name,variation_key,variation_key_hash' },
  // 0071 drops chapter_mastery (0058's table), retired by the knowledge-levels ladder.
  { migration: '0071', table: 'chapter_mastery', select: 'id', absent: true },
  { migration: '0072', table: 'chapter_completed', select: 'id,player_id,repertoire_id,chapter_name,reached_at' }
];

let failed = 0;

for (const probe of PROBES) {
  const res = await fetch(`${url}/rest/v1/${probe.table}?select=${probe.select}&limit=1`, { headers });
  const passed = probe.absent ? !res.ok : res.ok;
  if (passed) {
    console.log(`✓ ${probe.migration}  ${probe.table}${probe.absent ? ' (dropped)' : ` (${probe.select})`}`);
  } else if (probe.absent) {
    failed++;
    console.log(`✗ ${probe.migration}  ${probe.table}: still exists — the drop has not been applied`);
  } else {
    failed++;
    console.log(`✗ ${probe.migration}  ${probe.table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

// Every probe above is a `select ... limit 1` through PostgREST, which can only
// ever observe a table or a column. An RLS policy is invisible to it: the
// service role bypasses RLS, and `pg_policies` lives in `pg_catalog`, which
// PostgREST does not expose. So a migration whose entire content is
// `create policy` has no probe and cannot get one (GitHub issue #196).
//
// That is 8 of this repo's migrations, and it recurs every time RLS changes —
// which is where the coach/player anti-hijack protection lives. Silence about
// them reads as "verified" when it means "never checked", so they are listed
// explicitly instead. Derived by scanning rather than hardcoded, so a new
// policy-only migration appears here without anyone remembering to add it.
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

/** DDL a probe above could actually observe through PostgREST. */
const OBSERVABLE_DDL = /\b(create\s+table|create\s+or\s+replace\s+view|create\s+view|alter\s+table\s+\S+\s+add\s+column|drop\s+table)\b/i;

function policyOnlyMigrations(): string[] {
  // Both reads are of this repo's own committed migration files, at a path
  // built from `import.meta.url` — no user input reaches either. Same
  // justification as `src/lib/badges/catalog.test.ts`, which silences this
  // rule for the same reason.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path, see above
  const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
  return names.filter((name) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path, see above
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    return /\bcreate\s+policy\b/i.test(sql) && !OBSERVABLE_DDL.test(sql);
  });
}

const unverifiable = policyOnlyMigrations();
if (unverifiable.length > 0) {
  console.log('');
  console.log(`? ${unverifiable.length} migration(s) this script CANNOT verify — policy-only, so no probe can observe them:`);
  for (const name of unverifiable) console.log(`    ${name}`);
  console.log('');
  console.log('  Confirm those by hand in the Supabase SQL editor, e.g. for one table:');
  console.log("    select policyname, cmd from pg_policies where schemaname = 'public' and tablename = '<table>' order by policyname;");
  console.log('  Not counted as failures — they are unchecked, not broken (GitHub issue #196).');
}

console.log('');
console.log(failed === 0 ? 'All probes passed — schema matches what the code expects.' : `${failed} probe(s) failed — do NOT merge code that reads them.`);
process.exit(failed === 0 ? 0 : 1);
