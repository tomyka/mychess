// Read-only audit of the anonymous-user pile in production, for issue #90.
//
// Usage:
//   npm run anon:audit
//
// Prints ONLY aggregates and a per-table breakdown — never a row-per-user dump,
// since the pile is expected to be large. Nothing here writes or deletes: it
// issues GETs against the Supabase admin API and PostgREST, nothing else.
//
// The three questions #90 has to answer before any retention decision:
//   1. how many anonymous users are there, and how old are they
//   2. which of them have real progress vs. being empty shells
//   3. which users were once anonymous but have since converted to a real
//      account — those must never be touched

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via `npm run anon:audit`, which loads .env)');
  process.exit(1);
}

const authHeaders = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
};

const AUTH_PAGE_SIZE = 200;
const REST_PAGE_SIZE = 1000;
// A single table is never walked past this many rows — a runaway table
// (move_attempts on a busy repertoire) would otherwise page forever. If a
// table hits the cap it is reported as capped rather than silently truncated.
const REST_ROW_CAP = 200_000;

type AuthIdentity = { provider?: string };
type AuthUser = {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
  created_at: string;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
  identities?: AuthIdentity[];
};

/**
 * Tables the app seeds by itself for any account that merely EXISTS — a row
 * there proves nothing about the player having done anything, so it must not
 * count as "real progress":
 *   - player_stats / equipped_cosmetics: created on first authenticated request
 *   - quests: `ensureDailyQuests` seeds a day's quests on an authenticated hit,
 *     which the guest-session leak in #88 triggered for every crawler visit
 *   - level_progress: derived counters, same story
 * Anything discovered that is NOT in this set is treated as real progress —
 * deliberately the conservative direction, so a table nobody remembered blocks
 * a purge instead of being silently written off.
 */
const AUTO_SEEDED = new Set(['player_stats', 'equipped_cosmetics', 'quests', 'level_progress']);

/**
 * Every table in the live schema carrying a `player_id` column, read from
 * PostgREST's own OpenAPI document rather than from `supabase/migrations/*.sql`.
 * The migration history has drifted from the live schema more than once (see
 * CLAUDE.md), and a hand-written list is exactly how a progress table gets
 * missed — the first run of this audit listed four tables that no longer exist
 * (`level_progress`, `move_progress`, `variation_progress`,
 * `weekly_leaderboard`), which is proof the drift is real in both directions.
 */
async function discoverPlayerTables(): Promise<string[]> {
  const res = await fetch(`${url}/rest/v1/`, { headers: authHeaders });
  if (!res.ok) throw new Error(`rest/v1 OpenAPI fetch failed: ${res.status} ${await res.text()}`);
  const spec = (await res.json()) as {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
  };
  const tables = Object.entries(spec.definitions ?? {})
    .filter(([, def]) => def.properties && Object.hasOwn(def.properties, 'player_id'))
    .map(([name]) => name)
    .sort();
  if (tables.length === 0) throw new Error('OpenAPI document exposed no player_id tables — refusing to report a clean audit');
  return tables;
}

async function fetchAllUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE_SIZE}`, {
      headers: authHeaders
    });
    if (!res.ok) throw new Error(`admin/users page ${page} failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { users: AuthUser[] };
    users.push(...body.users);
    if (body.users.length < AUTH_PAGE_SIZE) break;
    page++;
  }
  return users;
}

/** Every distinct `player_id` present in `table`, or null if the table is missing/inaccessible. */
async function playerIdsIn(table: string): Promise<{ ids: Set<string>; rows: number; capped: boolean } | null> {
  const ids = new Set<string>();
  let rows = 0;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${url}/rest/v1/${table}?select=player_id&limit=${REST_PAGE_SIZE}&offset=${offset}`, {
      headers: authHeaders
    });
    if (!res.ok) {
      // A table that has since been dropped/renamed shouldn't abort the audit.
      console.warn(`  ! ${table}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      return null;
    }
    const batch = (await res.json()) as { player_id: string | null }[];
    for (const r of batch) if (r.player_id) ids.add(r.player_id);
    rows += batch.length;
    if (batch.length < REST_PAGE_SIZE) return { ids, rows, capped: false };
    offset += REST_PAGE_SIZE;
    if (offset >= REST_ROW_CAP) return { ids, rows, capped: true };
  }
}

/** player_stats rows that have moved off their all-zero defaults. */
async function nonDefaultStatsPlayers(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/player_stats?select=player_id,total_reviews,total_correct,moves_learned&limit=${REST_PAGE_SIZE}&offset=${offset}`,
      { headers: authHeaders }
    );
    if (!res.ok) {
      console.warn(`  ! player_stats: ${res.status} ${(await res.text()).slice(0, 120)}`);
      return ids;
    }
    const batch = (await res.json()) as {
      player_id: string;
      total_reviews: number;
      total_correct: number;
      moves_learned: number;
    }[];
    for (const r of batch) {
      if ((r.total_reviews ?? 0) > 0 || (r.total_correct ?? 0) > 0 || (r.moves_learned ?? 0) > 0) ids.add(r.player_id);
    }
    if (batch.length < REST_PAGE_SIZE) return ids;
    offset += REST_PAGE_SIZE;
  }
}

async function guestNamedProfiles(): Promise<Set<string>> {
  const ids = new Set<string>();
  const res = await fetch(`${url}/rest/v1/profiles?select=id,display_name&display_name=eq.Guest`, {
    headers: authHeaders
  });
  if (!res.ok) {
    console.warn(`  ! profiles(display_name=Guest): ${res.status}`);
    return ids;
  }
  for (const r of (await res.json()) as { id: string }[]) ids.add(r.id);
  return ids;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function pct(n: number, total: number): string {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  console.log('Fetching auth users…');
  const users = await fetchAllUsers();
  const anon = users.filter((u) => u.is_anonymous === true);
  const real = users.filter((u) => u.is_anonymous !== true);
  const anonIds = new Set(anon.map((u) => u.id));

  console.log('');
  console.log('=== TOTALS ===');
  console.log(`auth.users total : ${users.length}`);
  console.log(`anonymous        : ${anon.length} (${pct(anon.length, users.length)})`);
  console.log(`non-anonymous    : ${real.length}`);

  // --- age distribution -------------------------------------------------
  const byMonth = new Map<string, number>();
  for (const u of anon) byMonth.set(monthKey(u.created_at), (byMonth.get(monthKey(u.created_at)) ?? 0) + 1);
  console.log('');
  console.log('=== ANONYMOUS created_at BY MONTH ===');
  for (const m of [...byMonth.keys()].sort()) console.log(`${m}  ${String(byMonth.get(m)).padStart(6)}`);
  if (anon.length > 0) {
    const sorted = [...anon].sort((a, b) => a.created_at.localeCompare(b.created_at));
    console.log(`oldest: ${sorted[0].created_at}   newest: ${sorted[sorted.length - 1].created_at}`);
    const signedInAgain = anon.filter(
      (u) => u.last_sign_in_at && u.last_sign_in_at.slice(0, 19) !== u.created_at.slice(0, 19)
    ).length;
    console.log(`anonymous whose last_sign_in_at differs from created_at (returned at least once): ${signedInAgain}`);
  }

  // --- conversions (must never be purged) -------------------------------
  const guestNamed = await guestNamedProfiles();
  const convertedByIdentity = real.filter((u) => (u.identities ?? []).some((i) => i.provider === 'anonymous'));
  const convertedByProvider = real.filter((u) => (u.app_metadata?.providers ?? []).includes('anonymous'));
  const convertedByName = real.filter((u) => guestNamed.has(u.id));
  const convertedIds = new Set([
    ...convertedByIdentity.map((u) => u.id),
    ...convertedByProvider.map((u) => u.id),
    ...convertedByName.map((u) => u.id)
  ]);
  console.log('');
  console.log('=== FORMERLY-ANONYMOUS, NOW REAL (exclude from any purge) ===');
  console.log(`by auth identity provider 'anonymous' : ${convertedByIdentity.length}`);
  console.log(`by app_metadata.providers 'anonymous' : ${convertedByProvider.length}`);
  console.log(`by profiles.display_name = 'Guest'    : ${convertedByName.length}`);
  console.log(`distinct union                        : ${convertedIds.size}`);
  for (const id of convertedIds) {
    const u = users.find((x) => x.id === id)!;
    console.log(`  keep ${id}  ${u.email ?? '(no email)'}  created=${u.created_at}`);
  }

  // --- progress cross-reference ----------------------------------------
  const playerTables = await discoverPlayerTables();
  console.log('');
  console.log('=== PER-TABLE: ANONYMOUS USERS PRESENT ===');
  console.log(`(${playerTables.length} player_id tables discovered from the live schema)`);
  console.log('(auto = seeded by the app for any account that merely exists; not evidence of activity)');
  const anonWithRealProgress = new Set<string>();
  const anonWithAutoRows = new Set<string>();
  const statsMoved = await nonDefaultStatsPlayers();

  for (const table of playerTables) {
    const auto = AUTO_SEEDED.has(table);
    const found = await playerIdsIn(table);
    if (!found) continue;
    const anonHere = [...found.ids].filter((id) => anonIds.has(id));
    const flag = auto ? 'auto' : 'REAL';
    const cap = found.capped ? `  (CAPPED at ${REST_ROW_CAP} rows — count is a floor)` : '';
    console.log(
      `${table.padEnd(32)} ${flag}  rows=${String(found.rows).padStart(7)}  distinct players=${String(found.ids.size).padStart(6)}  anonymous=${String(anonHere.length).padStart(6)}${cap}`
    );
    for (const id of anonHere) (auto ? anonWithAutoRows : anonWithRealProgress).add(id);
  }

  // player_stats past its defaults counts as real activity even though the row
  // itself is auto-created.
  const anonStatsMoved = [...statsMoved].filter((id) => anonIds.has(id));
  for (const id of anonStatsMoved) anonWithRealProgress.add(id);
  console.log('');
  console.log(`anonymous with player_stats past all-zero defaults: ${anonStatsMoved.length}`);

  // --- verdict ---------------------------------------------------------
  const emptyShells = anon.filter((u) => !anonWithRealProgress.has(u.id));
  console.log('');
  console.log('=== SUMMARY FOR THE #90 DECISION ===');
  console.log(`anonymous users total                        : ${anon.length}`);
  console.log(`  with real progress (keep-or-purge choice)  : ${anonWithRealProgress.size}`);
  console.log(`  empty shells (auto-seeded rows only)       : ${emptyShells.length}`);
  console.log(`  of those shells, carrying auto rows        : ${[...anonWithAutoRows].filter((id) => !anonWithRealProgress.has(id)).length}`);
  console.log(`formerly-anonymous real accounts to preserve : ${convertedIds.size}`);
  if (anonWithRealProgress.size > 0) {
    console.log('');
    console.log('anonymous ids WITH real progress:');
    for (const id of anonWithRealProgress) {
      const u = anon.find((x) => x.id === id)!;
      console.log(`  ${id}  created=${u.created_at}  last_sign_in=${u.last_sign_in_at ?? 'never'}`);
    }
  }
  console.log('');
  console.log('Read-only audit complete — nothing was modified.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
