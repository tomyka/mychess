// Reports epic #95's two behavioural success criteria. Read-only.
//
//   npm run epic95:metrics
//
// Criterion 2 — after a repertoire reaches Learned, do practice/mastery sessions
//               outnumber learn sessions in the following 14 days? (target >=60%)
// Criterion 3 — is the per-repertoire demotion rate falling? (trailing 4 weeks
//               vs the first week of data)
//
// Recorded as a script rather than a note so the numbers can be re-pulled
// without rediscovering the queries. Both depend on data that only accumulates
// after #103 shipped, so expect thin output at first.

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run via `npm run epic95:metrics`)');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const DAY_MS = 24 * 60 * 60 * 1000;

async function get<T>(path: string): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

type Session = { player_id: string; repertoire_id: string | null; mode: string; started_at: string };
type Demotion = { player_id: string; repertoire_id: string; demoted_at: string };

function weekKey(iso: string): string {
  const d = new Date(iso);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

async function main() {
  const [sessions, demotions] = await Promise.all([
    get<Session>('sessions?select=player_id,repertoire_id,mode,started_at&order=started_at.asc'),
    get<Demotion>('variation_demotions?select=player_id,repertoire_id,demoted_at&order=demoted_at.asc')
  ]);

  console.log('=== CRITERION 2: session mode split ===');
  console.log(`session rows total: ${sessions.length}`);
  if (sessions.length === 0) {
    console.log('No sessions recorded yet. Note the writers for drill/time_trial were broken until #103,');
    console.log('and learn/practice/mastery only started recording then — so this fills in from now on.');
  } else {
    const byMode = new Map<string, number>();
    for (const s of sessions) byMode.set(s.mode, (byMode.get(s.mode) ?? 0) + 1);
    for (const [mode, n] of [...byMode].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${mode.padEnd(12)} ${String(n).padStart(5)}`);
    }
    const drilling = (byMode.get('practice') ?? 0) + (byMode.get('mastery') ?? 0);
    const learning = byMode.get('learn') ?? 0;
    const relevant = drilling + learning;
    console.log(
      relevant === 0
        ? '  (no learn/practice/mastery sessions yet)'
        : `  practice+mastery share: ${((drilling / relevant) * 100).toFixed(1)}%  (criterion 2 target: >=60% after Learned)`
    );
  }

  console.log('');
  console.log('=== CRITERION 3: demotion rate by week ===');
  console.log(`demotion rows total: ${demotions.length}`);
  if (demotions.length === 0) {
    console.log('No demotions recorded yet — nothing learned has been failed in Practice.');
  } else {
    const byWeek = new Map<string, number>();
    for (const d of demotions) byWeek.set(weekKey(d.demoted_at), (byWeek.get(weekKey(d.demoted_at)) ?? 0) + 1);
    const weeks = [...byWeek.keys()].sort();
    for (const w of weeks) console.log(`  week of ${w}  ${String(byWeek.get(w)).padStart(5)}`);
    if (weeks.length >= 2) {
      const first = byWeek.get(weeks[0]) ?? 0;
      const trailing = weeks.slice(-4).reduce((sum, w) => sum + (byWeek.get(w) ?? 0), 0) / Math.min(4, weeks.length);
      console.log(`  first week: ${first} · trailing-4-week mean: ${trailing.toFixed(1)} → ${trailing < first ? 'FALLING (criterion 3 met)' : 'not falling yet'}`);
    } else {
      console.log('  Only one week of data — criterion 3 needs at least two to show a trend.');
    }
  }

  console.log('');
  console.log('Read-only — nothing was modified.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
