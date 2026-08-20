// Read-only check that a migration actually took effect. CLAUDE.md is explicit
// that a migration must never be assumed applied — there is no linked Supabase
// CLI here, so the user runs the SQL by hand and this confirms the result.
//
//   npm run schema:check
//
// Add a probe per migration as new ones land; a probe is just "select these
// columns, limit 1" and passes only if PostgREST accepts them.

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via `npm run schema:check`)');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

const PROBES: { migration: string; table: string; select: string }[] = [
  { migration: '0057', table: 'variation_teaching_progress', select: 'clean_pass_count,last_clean_pass_at' },
  { migration: '0057', table: 'variation_demotions', select: 'id,player_id,variation_key,cause,demoted_at' },
  { migration: '0058', table: 'chapter_mastery', select: 'id,player_id,repertoire_id,chapter_name,mastered_at,moves_updated_at' },
  // 0059 widens a CHECK constraint, which a select can't observe — but the
  // column list is still worth pinning, because `sessions` was silently
  // unwritable for months: both writers sent `cards_reviewed`, a column that
  // has never existed in any migration (the real one is `cards_done`), and
  // neither checked the resulting error. See #103.
  { migration: '0059', table: 'sessions', select: 'id,player_id,repertoire_id,mode,cards_done,started_at' }
];

let failed = 0;

for (const probe of PROBES) {
  const res = await fetch(`${url}/rest/v1/${probe.table}?select=${probe.select}&limit=1`, { headers });
  if (res.ok) {
    console.log(`✓ ${probe.migration}  ${probe.table} (${probe.select})`);
  } else {
    failed++;
    console.log(`✗ ${probe.migration}  ${probe.table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

console.log('');
console.log(failed === 0 ? 'All probes passed — schema matches what the code expects.' : `${failed} probe(s) failed — do NOT merge code that reads them.`);
process.exit(failed === 0 ? 0 : 1);
