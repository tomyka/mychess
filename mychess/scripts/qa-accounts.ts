// Lists or deletes Supabase auth users, for issue #89 (leftover QA/test account cleanup).
//
// Usage:
//   tsx scripts/qa-accounts.ts list
//   tsx scripts/qa-accounts.ts delete <uuid> [<uuid> ...]
//
// `list` is read-only. `delete` only removes the exact UUIDs given on the
// command line — it never auto-detects or sweeps.

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const authHeaders = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
};

type AuthUser = {
  id: string;
  email?: string;
  is_anonymous?: boolean;
  created_at: string;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
};

type Profile = {
  id: string;
  display_name?: string | null;
  role?: string | null;
};

const TEST_HEURISTIC = /test|qa[-_.]|^qa@|\+.*@|@example\.com$|dummy|throwaway|scratch/i;

async function fetchAllUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: authHeaders
    });
    if (!res.ok) {
      throw new Error(`admin/users page ${page} failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { users: AuthUser[] };
    users.push(...body.users);
    if (body.users.length < 200) break;
    page++;
  }
  return users;
}

async function fetchProfiles(): Promise<Map<string, Profile>> {
  const res = await fetch(`${url}/rest/v1/profiles?select=id,display_name,role`, {
    headers: authHeaders
  });
  if (!res.ok) {
    throw new Error(`rest/v1/profiles failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as Profile[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function list() {
  const [users, profiles] = await Promise.all([fetchAllUsers(), fetchProfiles()]);
  console.log(`Total auth users: ${users.length}`);
  console.log('');
  for (const u of users) {
    const p = profiles.get(u.id);
    const flagged = u.email && TEST_HEURISTIC.test(u.email);
    const marker = flagged ? '[POSSIBLE TEST]' : '               ';
    console.log(
      `${marker} ${u.id}  ${u.email ?? '(no email)'}  anon=${!!u.is_anonymous}  role=${p?.role ?? '-'}  name=${p?.display_name ?? '-'}  created=${u.created_at}  last_sign_in=${u.last_sign_in_at ?? 'never'}`
    );
  }
  console.log('');
  console.log('Heuristic flags are hints only — confirm each account before deleting.');
}

async function del(ids: string[]) {
  if (ids.length === 0) {
    console.error('No ids given. Usage: tsx scripts/qa-accounts.ts delete <uuid> [<uuid> ...]');
    process.exit(1);
  }
  for (const id of ids) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders
    });
    if (res.ok) {
      console.log(`Deleted ${id}`);
    } else {
      console.error(`Failed to delete ${id}: ${res.status} ${await res.text()}`);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'list') {
  list().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (cmd === 'delete') {
  del(rest).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error('Usage: tsx scripts/qa-accounts.ts <list|delete> [uuids...]');
  process.exit(1);
}
