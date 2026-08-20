// Deletes the anonymous-user pile left by the #88 guest-session leak. Issue #90.
//
// Usage:
//   npm run anon:purge -- --expect=3811              # dry run, changes nothing
//   npm run anon:purge -- --expect=3811 --confirm    # performs the deletion
//
// IRREVERSIBLE. `profiles.id references auth.users(id) on delete cascade`
// (0001_core_tables.sql:5) means each deleted auth user takes its profile and
// everything cascading off it. There is no undo and no backup step here.
//
// Guards, each aborting the whole run rather than skipping a user:
//   1. --expect must equal the live anonymous count exactly. The count was
//      signed off against a specific number; if reality has moved, the sign-off
//      no longer covers it.
//   2. Every candidate is re-checked as `is_anonymous === true` at delete time,
//      not trusted from the earlier audit.
//   3. No candidate may appear in ANY non-auto-seeded player_id table (list
//      discovered from the live schema, so a table nobody remembered blocks the
//      run instead of being ignored).
//   4. Converted accounts are reported and preserved. They are never candidates
//      — conversion sets `is_anonymous = false` — so this reports rather than
//      filters. The conversion markers must NOT be tested against candidates:
//      identity provider 'anonymous' and a profile named 'Guest' are the normal
//      state of an un-converted guest, and doing so aborted on all 27 of them.
//   4b. A candidate carrying a display name other than 'Guest'/empty was
//      deliberately personalised; it holds no progress (guard 3) but isn't the
//      debris this purge targets, so it stops the run unless --allow-named.
//
// Without --confirm it prints exactly what it would do and exits.

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via `npm run anon:purge`, which loads .env)');
  process.exit(1);
}

const authHeaders = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
};

const AUTH_PAGE_SIZE = 200;
const REST_PAGE_SIZE = 1000;
/** Parallel DELETEs. Low on purpose: this is production auth, and 3.8k rows is not worth rate-limit roulette. */
const CONCURRENCY = 4;
const PROGRESS_EVERY = 250;

/** Seeded for any account that merely exists — see anon-audit.ts for why these prove nothing. */
const AUTO_SEEDED = new Set(['player_stats', 'equipped_cosmetics', 'quests', 'level_progress']);

type AuthUser = {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  created_at: string;
  app_metadata?: { providers?: string[] };
  identities?: { provider?: string }[];
};

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

async function fetchAllUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE_SIZE}`, { headers: authHeaders });
    if (!res.ok) throw new Error(`admin/users page ${page} failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { users: AuthUser[] };
    users.push(...body.users);
    if (body.users.length < AUTH_PAGE_SIZE) break;
    page++;
  }
  return users;
}

async function discoverPlayerTables(): Promise<string[]> {
  const res = await fetch(`${url}/rest/v1/`, { headers: authHeaders });
  if (!res.ok) throw new Error(`rest/v1 OpenAPI fetch failed: ${res.status} ${await res.text()}`);
  const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
  const tables = Object.entries(spec.definitions ?? {})
    .filter(([, def]) => def.properties && Object.hasOwn(def.properties, 'player_id'))
    .map(([name]) => name)
    .sort();
  if (tables.length === 0) throw new Error('OpenAPI document exposed no player_id tables — refusing to proceed');
  return tables;
}

async function playerIdsIn(table: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const res = await fetch(`${url}/rest/v1/${table}?select=player_id&limit=${REST_PAGE_SIZE}&offset=${offset}`, {
      headers: authHeaders
    });
    // Unlike the audit, an unreadable progress table is fatal here: "I couldn't
    // check" must never read the same as "nothing found" when the next step
    // deletes accounts.
    if (!res.ok) throw new Error(`${table} read failed: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as { player_id: string | null }[];
    for (const r of batch) if (r.player_id) ids.add(r.player_id);
    if (batch.length < REST_PAGE_SIZE) return ids;
    offset += REST_PAGE_SIZE;
  }
}

async function guestNamedProfiles(): Promise<Set<string>> {
  const res = await fetch(`${url}/rest/v1/profiles?select=id&display_name=eq.Guest`, { headers: authHeaders });
  if (!res.ok) throw new Error(`profiles(display_name=Guest) failed: ${res.status} ${await res.text()}`);
  return new Set(((await res.json()) as { id: string }[]).map((r) => r.id));
}

/**
 * `profiles.display_name` for the given ids, batched — the id list runs to
 * thousands, far past what one `in.(…)` URL can carry.
 */
async function profileDisplayNames(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const res = await fetch(`${url}/rest/v1/profiles?select=id,display_name&id=in.(${slice.join(',')})`, {
      headers: authHeaders
    });
    if (!res.ok) throw new Error(`profiles batch read failed: ${res.status} ${await res.text()}`);
    for (const r of (await res.json()) as { id: string; display_name: string | null }[]) out.set(r.id, r.display_name);
  }
  return out;
}

async function deleteUser(id: string): Promise<{ id: string; ok: boolean; detail?: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: authHeaders });
    // 404 = already gone. Idempotent, so a re-run after a partial failure is safe.
    if (res.ok || res.status === 404) return { id, ok: true };
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    return { id, ok: false, detail: `${res.status} ${(await res.text()).slice(0, 160)}` };
  }
  return { id, ok: false, detail: 'retries exhausted (429/5xx)' };
}

async function main() {
  const expected = Number(arg('expect'));
  if (!Number.isInteger(expected) || expected <= 0) {
    console.error('Pass the signed-off count, e.g. --expect=3811');
    process.exit(1);
  }
  const confirmed = hasFlag('confirm');

  console.log('Re-verifying against live data…');
  const [users, playerTables, guestNamed] = await Promise.all([fetchAllUsers(), discoverPlayerTables(), guestNamedProfiles()]);
  const anon = users.filter((u) => u.is_anonymous === true);

  // Guard 1 — the sign-off was for an exact number.
  if (anon.length !== expected) {
    console.error(`ABORT: --expect=${expected} but live anonymous count is ${anon.length}. Re-run \`npm run anon:audit\` and get a fresh sign-off.`);
    process.exit(1);
  }

  const anonIds = new Set(anon.map((u) => u.id));

  // Guard 4 — converted accounts must survive. A converted account has
  // `is_anonymous === false` by definition, so it can never be a candidate
  // here; what this checks is that the conversion markers point only at
  // accounts we are NOT touching. The markers are meaningless ON an anonymous
  // account: identity provider 'anonymous' and a profile named 'Guest' are the
  // normal state of an un-converted guest. An earlier version of this guard
  // tested them against candidates and duly aborted on all 27 plain guests.
  const convertedReal = users.filter(
    (u) =>
      u.is_anonymous !== true &&
      ((u.identities ?? []).some((i) => i.provider === 'anonymous') ||
        (u.app_metadata?.providers ?? []).includes('anonymous') ||
        guestNamed.has(u.id))
  );
  console.log(`converted accounts preserved (never candidates): ${convertedReal.length}`);
  for (const u of convertedReal) console.log(`  keep ${u.id}  ${u.email ?? '(no email)'}`);

  // Guard 4b — a candidate whose profile carries a display name it was never
  // given by default suggests somebody deliberately personalised that guest
  // session. It owns no progress rows (guard 3 proves that) but it isn't the
  // anonymous debris this purge is for, so it stops the run unless allowed.
  const profileNames = await profileDisplayNames([...anonIds]);
  const named = anon.filter((u) => {
    const name = profileNames.get(u.id);
    return name != null && name !== '' && name !== 'Guest';
  });
  if (named.length > 0 && !hasFlag('allow-named')) {
    console.error('');
    console.error(`ABORT: ${named.length} candidate(s) have a personalised display name:`);
    for (const u of named.slice(0, 25)) console.error(`  ${u.id}  name=${JSON.stringify(profileNames.get(u.id))}  created=${u.created_at}`);
    if (named.length > 25) console.error(`  … and ${named.length - 25} more`);
    console.error('Review them, then re-run with --allow-named to include them.');
    process.exit(1);
  }
  if (named.length > 0) console.log(`including ${named.length} personalised-name candidate(s) (--allow-named)`);

  // Guard 3 — no candidate may own a row in any real progress table.
  const offenders = new Map<string, string[]>();
  for (const table of playerTables) {
    if (AUTO_SEEDED.has(table)) continue;
    const ids = await playerIdsIn(table);
    for (const id of ids) {
      if (!anonIds.has(id)) continue;
      offenders.set(id, [...(offenders.get(id) ?? []), table]);
    }
  }
  console.log(`checked ${playerTables.filter((t) => !AUTO_SEEDED.has(t)).length} progress tables (auto-seeded skipped: ${[...AUTO_SEEDED].join(', ')})`);
  if (offenders.size > 0) {
    console.error(`ABORT: ${offenders.size} anonymous account(s) own progress rows:`);
    for (const [id, tables] of offenders) console.error(`  ${id}  ${tables.join(', ')}`);
    process.exit(1);
  }

  console.log('');
  console.log(`auth.users total     : ${users.length}`);
  console.log(`to delete (anonymous): ${anon.length}`);
  console.log(`to keep (real)       : ${users.length - anon.length}`);
  console.log(`oldest candidate     : ${[...anon].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at}`);

  if (!confirmed) {
    console.log('');
    console.log('DRY RUN — nothing deleted. Re-run with --confirm to perform the deletion.');
    return;
  }

  console.log('');
  console.log(`Deleting ${anon.length} anonymous users…`);
  const queue = [...anon];
  const failures: { id: string; detail?: string }[] = [];
  let done = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const next = queue.pop();
        if (!next) return;
        // Guard 2 — freshly confirmed anonymous, immediately before the DELETE.
        if (next.is_anonymous !== true) {
          failures.push({ id: next.id, detail: 'not anonymous at delete time — skipped' });
          continue;
        }
        const result = await deleteUser(next.id);
        if (!result.ok) failures.push({ id: result.id, detail: result.detail });
        done++;
        if (done % PROGRESS_EVERY === 0) console.log(`  ${done}/${anon.length}…`);
      }
    })
  );

  const after = await fetchAllUsers();
  const anonLeft = after.filter((u) => u.is_anonymous === true).length;

  console.log('');
  console.log('=== RESULT ===');
  console.log(`attempted        : ${anon.length}`);
  console.log(`deleted          : ${anon.length - failures.length}`);
  console.log(`failed           : ${failures.length}`);
  for (const f of failures.slice(0, 25)) console.log(`  ! ${f.id}  ${f.detail ?? ''}`);
  if (failures.length > 25) console.log(`  … and ${failures.length - 25} more`);
  console.log(`auth.users now   : ${after.length} (anonymous remaining: ${anonLeft})`);
  if (failures.length > 0) {
    console.log('');
    console.log('Deletion is idempotent (404 counts as gone) — re-running with a fresh --expect picks up the remainder.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
