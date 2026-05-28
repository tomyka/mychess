# mychess Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core mychess MVP -- a web+PWA chess opening trainer for kids covering auth, PGN import, repertoire tree, Learn + Practice modes (FSRS), and basic gamification (XP/level/streak).

**Architecture:** SvelteKit 2 app with two route groups `/(kid)` and `/(coach)`; Supabase for Postgres (RLS), Auth (Google OAuth), Storage (PGN blobs), and Edge Functions (PGN parsing). FSRS v4 spaced-repetition via ts-fsrs drives the review queue; chessground renders the board; all sensitive writes go through SECURITY DEFINER RPCs.

**Tech Stack:** SvelteKit 2, TypeScript, Tailwind CSS 4, chessground, chess.js, ts-fsrs, Supabase (Postgres + Auth + Storage + Edge Functions), TanStack Query, @vite-pwa/sveltekit, Vitest, Playwright, Vercel.

---

### Task 1: Project Scaffold

**Files:**
- Create: `mychess/` (SvelteKit project root)
- Create: `.env.example`

- [ ] **Step 1: Create SvelteKit project**

```bash
npm create svelte@latest mychess
# Select: Skeleton project, TypeScript, ESLint, Prettier, Vitest, Playwright
cd mychess
```

- [ ] **Step 2: Install all dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr chessground chess.js ts-fsrs
npm install @tanstack/svelte-query @vite-pwa/sveltekit
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Tailwind in vite.config.ts**

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: { name: 'mychess', short_name: 'mychess', theme_color: '#1e293b' }
    })
  ]
});
```

Create `src/app.css`:

```css
@import 'tailwindcss';
```

Add `<link rel="stylesheet" href="%sveltekit.assets%/app.css">` to `src/app.html` head.

- [ ] **Step 4: Create .env.example**

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Copy `.env.example` to `.env` and fill real Supabase values.

- [ ] **Step 5: Verify dev server**

```bash
npm run dev
```
Expected: Server at http://localhost:5173, no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold SvelteKit project with all deps"
```

---

### Task 2: Supabase CLI Setup

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/` (directory)

- [ ] **Step 1: Initialize Supabase CLI**

```bash
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

- [ ] **Step 2: Enable Google OAuth**

In Supabase dashboard -> Authentication -> Providers -> Google:
- Add Client ID and Client Secret from Google Cloud Console.
- Authorized redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
- Also add `http://localhost:5173/auth/callback` for local dev.

- [ ] **Step 3: Verify**

```bash
npx supabase status
```
Expected: Shows project URL matching `.env`.

- [ ] **Step 4: Commit**

```bash
git add supabase/ && git commit -m "chore: supabase CLI initialized"
```

---

### Task 3: DB Migration -- Core Tables

**Files:**
- Create: `supabase/migrations/0001_core_tables.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0001_core_tables.sql`:

```sql
create extension if not exists "uuid-ossp";
create extension if not exists "pgsodium";

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('kid','coach')),
  display_name  text not null,
  avatar_id     text not null default 'knight',
  xp            integer not null default 0,
  level         integer not null default 1,
  streak_days   integer not null default 0,
  streak_freeze integer not null default 0,
  last_active_date date,
  daily_goal    integer not null default 10,
  coach_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create table public.invites (
  id          uuid primary key default uuid_generate_v4(),
  coach_id    uuid not null references public.profiles(id),
  token       text not null unique default encode(gen_random_bytes(24),'base64url'),
  kid_email   text,
  redeemed_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);

create table public.repertoires (
  id         uuid primary key default uuid_generate_v4(),
  kid_id     uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  color      text not null check (color in ('white','black')),
  is_draft   boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.positions (
  id  uuid primary key default uuid_generate_v4(),
  fen text not null unique
);

create table public.moves (
  id            uuid primary key default uuid_generate_v4(),
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  from_position uuid references public.positions(id),
  to_position   uuid not null references public.positions(id),
  san           text not null,
  move_number   integer not null,
  is_kid_turn   boolean not null,
  annotation    text,
  created_at    timestamptz not null default now(),
  unique (repertoire_id, from_position, san)
);

create table public.reviews (
  id             uuid primary key default uuid_generate_v4(),
  kid_id         uuid not null references public.profiles(id) on delete cascade,
  move_id        uuid not null references public.moves(id) on delete cascade,
  due_at         timestamptz not null default now(),
  stability      float8 not null default 0,
  difficulty     float8 not null default 0,
  elapsed_days   float8 not null default 0,
  scheduled_days float8 not null default 0,
  reps           integer not null default 0,
  lapses         integer not null default 0,
  state          text not null default 'New' check (state in ('New','Learning','Review','Relearning')),
  last_review    timestamptz,
  unique (kid_id, move_id)
);

create table public.sessions (
  id            uuid primary key default uuid_generate_v4(),
  kid_id        uuid not null references public.profiles(id),
  repertoire_id uuid references public.repertoires(id),
  mode          text not null check (mode in ('learn','practice')),
  cards_done    integer not null default 0,
  xp_earned     integer not null default 0,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create table public.review_events (
  id         uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  move_id    uuid not null references public.moves(id),
  rating     text not null check (rating in ('again','hard','good','easy')),
  latency_ms integer not null,
  used_hint  boolean not null default false,
  xp_delta   integer not null,
  created_at timestamptz not null default now()
);

create table public.kid_stats (
  kid_id        uuid primary key references public.profiles(id) on delete cascade,
  total_reviews integer not null default 0,
  total_correct integer not null default 0,
  moves_learned integer not null default 0,
  updated_at    timestamptz not null default now()
);

create table public.badges (
  id          text primary key,
  name        text not null,
  description text not null,
  icon_url    text not null,
  xp_reward   integer not null default 0
);

create table public.badges_earned (
  kid_id    uuid references public.profiles(id) on delete cascade,
  badge_id  text references public.badges(id),
  earned_at timestamptz not null default now(),
  primary key (kid_id, badge_id)
);

create table public.coach_notes (
  id         uuid primary key default uuid_generate_v4(),
  coach_id   uuid not null references public.profiles(id),
  kid_id     uuid not null references public.profiles(id),
  note       text not null,
  created_at timestamptz not null default now()
);

create table public.avatars   (id text primary key, name text, svg_url text);
create table public.themes    (id text primary key, name text, light_square text, dark_square text);
create table public.piece_sets(id text primary key, name text, sprite_url text);

create table public.equipped_cosmetics (
  kid_id    uuid primary key references public.profiles(id) on delete cascade,
  avatar_id text references public.avatars(id) default 'knight',
  theme_id  text references public.themes(id) default 'classic',
  piece_set text references public.piece_sets(id) default 'standard'
);
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```
Expected: Migration applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_core_tables.sql
git commit -m "feat(db): core tables migration"
```

---

### Task 4: DB Migration -- RLS Policies

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_rls.sql`:

```sql
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.repertoires enable row level security;
alter table public.positions enable row level security;
alter table public.moves enable row level security;
alter table public.reviews enable row level security;
alter table public.sessions enable row level security;
alter table public.review_events enable row level security;
alter table public.kid_stats enable row level security;
alter table public.badges_earned enable row level security;
alter table public.coach_notes enable row level security;
alter table public.equipped_cosmetics enable row level security;

-- Profiles
create policy "profiles_self_read"  on public.profiles for select using (id = auth.uid());
create policy "profiles_self_write" on public.profiles for update using (id = auth.uid());
create policy "profiles_coach_read" on public.profiles for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach')
  and coach_id = auth.uid()
);

-- Repertoires
create policy "repertoires_kid_all"    on public.repertoires for all    using (kid_id = auth.uid());
create policy "repertoires_coach_read" on public.repertoires for select using (
  exists (select 1 from public.profiles k where k.id = kid_id and k.coach_id = auth.uid())
);

-- Positions (shared, all authenticated can read)
create policy "positions_auth_read" on public.positions for select using (auth.role() = 'authenticated');

-- Moves
create policy "moves_kid_all" on public.moves for all using (
  exists (select 1 from public.repertoires r where r.id = repertoire_id and r.kid_id = auth.uid())
);
create policy "moves_coach_read" on public.moves for select using (
  exists (
    select 1 from public.repertoires r
    join public.profiles k on k.id = r.kid_id
    where r.id = repertoire_id and k.coach_id = auth.uid()
  )
);

-- Reviews
create policy "reviews_kid_all"    on public.reviews for all    using (kid_id = auth.uid());
create policy "reviews_coach_read" on public.reviews for select using (
  exists (select 1 from public.profiles k where k.id = kid_id and k.coach_id = auth.uid())
);

-- Sessions
create policy "sessions_kid_all"    on public.sessions for all    using (kid_id = auth.uid());
create policy "sessions_coach_read" on public.sessions for select using (
  exists (select 1 from public.profiles k where k.id = kid_id and k.coach_id = auth.uid())
);

-- Review events
create policy "review_events_kid_all" on public.review_events for all using (
  exists (select 1 from public.sessions s where s.id = session_id and s.kid_id = auth.uid())
);

-- Kid stats
create policy "kid_stats_self"  on public.kid_stats for select using (kid_id = auth.uid());
create policy "kid_stats_coach" on public.kid_stats for select using (
  exists (select 1 from public.profiles k where k.id = kid_id and k.coach_id = auth.uid())
);

-- Badges earned
create policy "badges_kid_read"   on public.badges_earned for select using (kid_id = auth.uid());
create policy "badges_coach_read" on public.badges_earned for select using (
  exists (select 1 from public.profiles k where k.id = kid_id and k.coach_id = auth.uid())
);

-- Coach notes
create policy "coach_notes_coach_all" on public.coach_notes for all    using (coach_id = auth.uid());
create policy "coach_notes_kid_read"  on public.coach_notes for select using (kid_id = auth.uid());

-- Equipped cosmetics
create policy "cosmetics_kid_all" on public.equipped_cosmetics for all using (kid_id = auth.uid());

-- Invites
create policy "invites_coach_all"      on public.invites for all    using (coach_id = auth.uid());
create policy "invites_read_by_token"  on public.invites for select using (true);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db push
```
Expected: No errors. RLS active on all tables.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): RLS policies for all Phase A tables"
```


---

### Task 5: DB Migration -- SECURITY DEFINER RPCs

**Files:**
- Create: `supabase/migrations/0003_rpcs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_rpcs.sql`:

```sql
create or replace function public.update_xp_and_level(p_kid_id uuid, p_xp_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_new_xp    integer;
  v_new_level integer := 1;
  v_threshold integer := 0;
  v_thresholds integer[] := array[0,100,250,500,1000];
begin
  update profiles set xp = greatest(0, xp + p_xp_delta)
  where id = p_kid_id returning xp into v_new_xp;

  loop
    if v_new_level <= array_length(v_thresholds,1) then
      v_threshold := v_thresholds[v_new_level];
    else
      v_threshold := round(v_threshold * 1.6 / 50.0) * 50;
    end if;
    exit when v_new_xp < v_threshold;
    v_new_level := v_new_level + 1;
  end loop;

  update profiles set level = greatest(1, v_new_level - 1) where id = p_kid_id;
end;
$$;

create or replace function public.update_streak(p_kid_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last  date;
  v_today date := current_date;
  v_freeze integer;
begin
  select last_active_date, streak_freeze into v_last, v_freeze
  from profiles where id = p_kid_id;

  if v_last = v_today then return; end if;

  if v_last = v_today - 1 then
    update profiles set streak_days = streak_days + 1, last_active_date = v_today where id = p_kid_id;
  elsif v_last = v_today - 2 and v_freeze > 0 then
    update profiles set streak_freeze = streak_freeze - 1, last_active_date = v_today where id = p_kid_id;
  else
    update profiles set streak_days = 1, last_active_date = v_today where id = p_kid_id;
  end if;

  update profiles set streak_freeze = least(2, streak_freeze + 1)
  where id = p_kid_id and streak_days % 7 = 0;
end;
$$;

create or replace function public.submit_session_result(
  p_session_id uuid,
  p_events     jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_kid_id   uuid;
  v_xp_total integer := 0;
  v_event    jsonb;
begin
  select kid_id into v_kid_id from sessions
  where id = p_session_id and kid_id = auth.uid();
  if not found then raise exception 'session not found or unauthorized'; end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    insert into review_events(session_id, move_id, rating, latency_ms, used_hint, xp_delta)
    values (
      p_session_id,
      (v_event->>'move_id')::uuid,
      v_event->>'rating',
      (v_event->>'latency_ms')::integer,
      (v_event->>'used_hint')::boolean,
      (v_event->>'xp_delta')::integer
    );

    update reviews set
      due_at         = (v_event->>'due_at')::timestamptz,
      stability      = (v_event->>'stability')::float8,
      difficulty     = (v_event->>'difficulty')::float8,
      elapsed_days   = (v_event->>'elapsed_days')::float8,
      scheduled_days = (v_event->>'scheduled_days')::float8,
      reps           = (v_event->>'reps')::integer,
      lapses         = (v_event->>'lapses')::integer,
      state          = v_event->>'state',
      last_review    = now()
    where kid_id = v_kid_id and move_id = (v_event->>'move_id')::uuid;

    v_xp_total := v_xp_total + (v_event->>'xp_delta')::integer;
  end loop;

  update sessions
  set cards_done = jsonb_array_length(p_events), xp_earned = v_xp_total, ended_at = now()
  where id = p_session_id;

  perform public.update_xp_and_level(v_kid_id, v_xp_total);
  perform public.update_streak(v_kid_id);

  update kid_stats set
    total_reviews = total_reviews + jsonb_array_length(p_events),
    total_correct = total_correct + (
      select count(*) from jsonb_array_elements(p_events) e
      where e->>'rating' != 'again'
    ),
    updated_at = now()
  where kid_id = v_kid_id;
end;
$$;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```
Expected: 3 functions created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_rpcs.sql
git commit -m "feat(db): SECURITY DEFINER RPCs for session submission, XP, and streak"
```

---

### Task 6: DB Migration -- Seed Data

**Files:**
- Create: `supabase/migrations/0004_seed.sql`

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/0004_seed.sql`:

```sql
insert into public.avatars (id, name, svg_url) values
  ('knight',    'Sir Knight',   '/avatars/knight.svg'),
  ('pawn',      'Pawn Star',    '/avatars/pawn.svg'),
  ('bishop',    'Cool Bishop',  '/avatars/bishop.svg'),
  ('rook',      'Castle Rock',  '/avatars/rook.svg'),
  ('queen',     'Queen B',      '/avatars/queen.svg'),
  ('king',      'King Leo',     '/avatars/king.svg'),
  ('dragon',    'Dragon',       '/avatars/dragon.svg'),
  ('robot',     'ChessBot',     '/avatars/robot.svg'),
  ('unicorn',   'Unicorn',      '/avatars/unicorn.svg'),
  ('wizard',    'Wizard',       '/avatars/wizard.svg'),
  ('ninja',     'Chess Ninja',  '/avatars/ninja.svg'),
  ('astronaut', 'Space Champ',  '/avatars/astronaut.svg')
on conflict (id) do nothing;

insert into public.themes (id, name, light_square, dark_square) values
  ('classic', 'Classic', '#f0d9b5', '#b58863'),
  ('ocean',   'Ocean',   '#dee3e6', '#8ca2ad'),
  ('forest',  'Forest',  '#ffffdd', '#86a666'),
  ('candy',   'Candy',   '#ffd6e0', '#c9184a'),
  ('space',   'Space',   '#1a1a2e', '#16213e'),
  ('gold',    'Gold',    '#f9e4b7', '#c8a951')
on conflict (id) do nothing;

insert into public.piece_sets (id, name, sprite_url) values
  ('standard', 'Standard', '/pieces/standard/'),
  ('cartoon',  'Cartoon',  '/pieces/cartoon/'),
  ('pixel',    'Pixel',    '/pieces/pixel/'),
  ('animals',  'Animals',  '/pieces/animals/')
on conflict (id) do nothing;

insert into public.badges (id, name, description, icon_url, xp_reward) values
  ('first_move',  'First Move!',   'Complete your first training card',        '/badges/first_move.svg',  10),
  ('week_streak', '7-Day Streak',  'Train 7 days in a row',                   '/badges/week_streak.svg', 50),
  ('centurion',   'Centurion',     'Review 100 cards total',                  '/badges/centurion.svg',   25),
  ('uploader',    'PGN Master',    'Upload your first repertoire from a file', '/badges/uploader.svg',   15),
  ('level_5',     'Level 5!',      'Reach level 5',                           '/badges/level5.svg',     30)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```
Expected: Seed rows inserted.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_seed.sql
git commit -m "feat(db): seed catalog data (avatars, themes, piece sets, badges)"
```

---

### Task 7: Supabase Client + Auth Store

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/hooks.server.ts`
- Create: `src/routes/auth/callback/+server.ts`
- Create: `src/app.d.ts`

- [ ] **Step 1: Create Supabase client singleton**

Create `src/lib/supabase/client.ts`:

```typescript
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

export function createSupabaseClient() {
  if (isBrowser()) {
    return createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  }
  return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} }
  });
}
```

- [ ] **Step 2: Create server hook**

Create `src/hooks.server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) =>
        event.cookies.set(name, value, { ...options, path: '/' })
      )
    }
  });

  event.locals.safeGetSession = async () => {
    const { data: { session } } = await event.locals.supabase.auth.getSession();
    if (!session) return { session: null, user: null, profile: null };
    const { data: profile } = await event.locals.supabase
      .from('profiles').select('*').eq('id', session.user.id).single();
    return { session, user: session.user, profile };
  };

  return resolve(event, {
    filterSerializedResponseHeaders: (name) =>
      name === 'content-range' || name === 'x-supabase-api-version'
  });
};
```

- [ ] **Step 3: Create auth callback route**

Create `src/routes/auth/callback/+server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
  const code = url.searchParams.get('code');
  if (code) await supabase.auth.exchangeCodeForSession(code);
  throw redirect(303, '/');
};
```

- [ ] **Step 4: Update app.d.ts**

Replace `src/app.d.ts` contents:

```typescript
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{ session: Session | null; user: User | null; profile: any | null }>;
    }
    interface PageData {
      session: Session | null;
      profile: any | null;
    }
  }
}
export {};
```

- [ ] **Step 5: Generate Supabase types**

```bash
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

- [ ] **Step 6: Verify build**

```bash
npm run check
```
Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/ && git commit -m "feat: Supabase client singleton, server hook, auth callback"
```

---

### Task 8: Route Guard Layouts

**Files:**
- Create: `src/routes/+layout.server.ts`
- Create: `src/routes/+layout.svelte`
- Create: `src/routes/(kid)/+layout.server.ts`
- Create: `src/routes/(coach)/+layout.server.ts`

- [ ] **Step 1: Root layout server**

Create `src/routes/+layout.server.ts`:

```typescript
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
  return await safeGetSession();
};
```

- [ ] **Step 2: Root layout Svelte**

Create `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  import { QueryClientProvider, QueryClient } from '@tanstack/svelte-query';
  const queryClient = new QueryClient();
</script>
<QueryClientProvider client={queryClient}>
  <slot />
</QueryClientProvider>
```

- [ ] **Step 3: Kid layout guard**

Create `src/routes/(kid)/+layout.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
  const data = await safeGetSession();
  if (!data.session) throw redirect(303, '/login');
  if (!data.profile) throw redirect(303, '/welcome');
  if (data.profile.role !== 'kid') throw redirect(303, '/coach');
  return data;
};
```

- [ ] **Step 4: Coach layout guard**

Create `src/routes/(coach)/+layout.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
  const data = await safeGetSession();
  if (!data.session) throw redirect(303, '/login');
  if (!data.profile) throw redirect(303, '/welcome');
  if (data.profile.role !== 'coach') throw redirect(303, '/');
  return data;
};
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/ && git commit -m "feat: route guards for kid and coach layouts"
```

---

### Task 9: Login + Welcome Pages

**Files:**
- Create: `src/routes/login/+page.svelte`
- Create: `src/routes/welcome/+page.svelte`
- Create: `src/routes/welcome/+page.server.ts`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Login page**

Create `src/routes/login/+page.svelte`:

```svelte
<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  const sb = createSupabaseClient();
  async function signIn() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    });
  }
</script>
<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8">
  <div class="text-center">
    <h1 class="text-5xl font-bold text-yellow-400">mychess</h1>
    <p class="mt-2 text-slate-300">Learn openings. Have fun. Level up!</p>
  </div>
  <button on:click={signIn}
    class="flex items-center gap-3 bg-white text-slate-900 px-6 py-3 rounded-full font-semibold shadow-lg hover:shadow-xl transition">
    <svg class="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
    Sign in with Google
  </button>
</main>
```

- [ ] **Step 2: Welcome page server**

Create `src/routes/welcome/+page.server.ts`:

```typescript
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
  const { session, profile } = await safeGetSession();
  if (!session) throw redirect(303, '/login');
  if (profile) throw redirect(303, profile.role === 'coach' ? '/coach' : '/');
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Not logged in' });
    const data = await request.formData();
    const role = data.get('role') as string;
    const display_name = data.get('display_name') as string;
    if (!role || !display_name) return fail(400, { error: 'Missing fields' });

    await supabase.from('profiles').upsert({ id: user.id, role, display_name, avatar_id: 'knight' });
    await supabase.from('kid_stats').upsert({ kid_id: user.id });
    await supabase.from('equipped_cosmetics').upsert({ kid_id: user.id });

    throw redirect(303, role === 'coach' ? '/coach' : '/');
  }
};
```

- [ ] **Step 3: Welcome page UI**

Create `src/routes/welcome/+page.svelte`:

```svelte
<script lang="ts">
  let role = 'kid';
</script>
<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8 p-6">
  <h1 class="text-4xl font-bold text-yellow-400">Welcome to mychess!</h1>
  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm">
    <label class="flex flex-col gap-1">
      <span class="text-sm text-slate-400">Your name</span>
      <input name="display_name" required
        class="rounded-xl px-4 py-3 bg-slate-800 border border-slate-600 text-white" />
    </label>
    <div class="flex gap-3">
      {#each ['kid', 'coach'] as r}
        <button type="button" on:click={() => role = r}
          class="flex-1 py-3 rounded-xl font-semibold transition {role === r ? 'bg-yellow-400 text-slate-900' : 'bg-slate-700 text-white'}">
          {r === 'kid' ? 'I am a Player' : 'I am a Coach'}
        </button>
      {/each}
    </div>
    <input type="hidden" name="role" value={role} />
    <button type="submit"
      class="bg-yellow-400 text-slate-900 py-3 rounded-xl font-bold hover:bg-yellow-300 transition">
      Let's Go!
    </button>
  </form>
</main>
```

- [ ] **Step 4: Root page (redirect hub)**

Replace `src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  $: if (!$page.data.session) goto('/login');
  else if (!$page.data.profile) goto('/welcome');
  else if ($page.data.profile.role === 'coach') goto('/coach');
</script>
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/ && git commit -m "feat: login, welcome, and role-selection pages"
```

---

### Task 10: Invite System

**Files:**
- Create: `src/routes/(coach)/invite/+page.svelte`
- Create: `src/routes/(coach)/invite/+page.server.ts`
- Create: `src/routes/join/[token]/+page.svelte`
- Create: `src/routes/join/[token]/+page.server.ts`

- [ ] **Step 1: Coach invite page server**

Create `src/routes/(coach)/invite/+page.server.ts`:

```typescript
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: invites } = await supabase.from('invites')
    .select('*').eq('coach_id', user!.id).order('created_at', { ascending: false });
  return { invites: invites ?? [] };
};

export const actions: Actions = {
  create: async ({ locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401);
    const { data, error } = await supabase.from('invites')
      .insert({ coach_id: user.id }).select().single();
    if (error) return fail(500, { error: error.message });
    return { token: data.token };
  }
};
```

- [ ] **Step 2: Coach invite UI**

Create `src/routes/(coach)/invite/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  export let data: { invites: any[] };
  export let form: any;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
</script>
<div class="p-6 max-w-lg mx-auto text-white">
  <h1 class="text-2xl font-bold mb-4">Invite a Player</h1>
  <form method="POST" action="?/create" use:enhance>
    <button class="bg-yellow-400 text-slate-900 px-6 py-3 rounded-xl font-bold">Generate Invite Link</button>
  </form>
  {#if form?.token}
    <div class="mt-4 p-4 bg-slate-800 rounded-xl">
      <p class="text-sm text-slate-400 mb-1">Share this link:</p>
      <p class="font-mono text-yellow-400 break-all">{origin}/join/{form.token}</p>
    </div>
  {/if}
  <h2 class="text-xl font-bold mt-8 mb-2">Past Invites</h2>
  <ul class="space-y-2">
    {#each data.invites as inv}
      <li class="bg-slate-800 rounded-xl p-3 text-sm font-mono">
        /join/{inv.token}
        {#if inv.redeemed_at}<span class="text-green-400 ml-2">Redeemed</span>
        {:else if new Date(inv.expires_at) < new Date()}<span class="text-red-400 ml-2">Expired</span>
        {:else}<span class="text-slate-400 ml-2">Pending</span>{/if}
      </li>
    {/each}
  </ul>
</div>
```

- [ ] **Step 3: Join page server**

Create `src/routes/join/[token]/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { data: invite } = await supabase.from('invites').select('*')
    .eq('token', params.token).single();
  if (!invite || invite.redeemed_at || new Date(invite.expires_at) < new Date()) {
    return { valid: false };
  }
  const { user } = await safeGetSession();
  if (!user) return { valid: true, token: params.token, needsLogin: true };

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return { valid: true, token: params.token, needsProfile: true, coachId: invite.coach_id };

  await supabase.from('profiles').update({ coach_id: invite.coach_id }).eq('id', user.id);
  await supabase.from('invites').update({ redeemed_at: new Date().toISOString() }).eq('token', params.token);
  throw redirect(303, '/');
};
```

- [ ] **Step 4: Join page UI**

Create `src/routes/join/[token]/+page.svelte`:

```svelte
<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  export let data: any;
  const sb = createSupabaseClient();
  async function signIn() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/join/${data.token}` }
    });
  }
</script>
<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-6">
  {#if !data.valid}
    <p class="text-red-400 text-xl">This invite link is invalid or has expired.</p>
  {:else if data.needsLogin}
    <h1 class="text-3xl font-bold text-yellow-400">You've been invited to mychess!</h1>
    <button on:click={signIn}
      class="bg-white text-slate-900 px-8 py-4 rounded-full font-bold text-lg">
      Sign in with Google to Accept
    </button>
  {:else}
    <p class="text-slate-300">Setting up your account...</p>
  {/if}
</main>
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/ && git commit -m "feat: coach invite system and /join/[token] redemption"
```

---

### Task 11: PGN Parser Library

**Files:**
- Create: `src/lib/pgn/parser.ts`
- Create: `src/lib/pgn/parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/pgn/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePgn } from './parser';

const LINEAR_PGN = `[Event "Test"]
1. e4 e5 2. Nf3 Nc6 *`;

describe('parsePgn', () => {
  it('parses linear game into positions and moves', () => {
    const r = parsePgn(LINEAR_PGN, 'white');
    expect(r.moves.length).toBe(4);
    expect(r.positions.length).toBeGreaterThan(0);
  });

  it('first move SAN is e4', () => {
    const r = parsePgn(LINEAR_PGN, 'white');
    expect(r.moves[0].san).toBe('e4');
  });

  it('marks white moves as kid turn when playing white', () => {
    const r = parsePgn(LINEAR_PGN, 'white');
    const whiteMoves = r.moves.filter(m => m.is_kid_turn);
    expect(whiteMoves.length).toBe(2); // e4, Nf3
  });

  it('marks black moves as kid turn when playing black', () => {
    const r = parsePgn(LINEAR_PGN, 'black');
    const blackMoves = r.moves.filter(m => m.is_kid_turn);
    expect(blackMoves.length).toBe(2); // e5, Nc6
  });

  it('returns error field for invalid PGN', () => {
    const r = parsePgn('not pgn', 'white');
    expect(r.moves).toHaveLength(0);
  });

  it('returns error for PGN exceeding maxPositions', () => {
    const r = parsePgn(LINEAR_PGN, 'white', 2);
    expect(r.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- src/lib/pgn/parser.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement parser**

Create `src/lib/pgn/parser.ts`:

```typescript
import { Chess } from 'chess.js';

export interface ParsedPosition { fen: string; }

export interface ParsedMove {
  from_fen: string | null;
  to_fen: string;
  san: string;
  move_number: number;
  is_kid_turn: boolean;
}

export interface ParsedRepertoire {
  positions: ParsedPosition[];
  moves: ParsedMove[];
  error?: string;
}

export function parsePgn(pgn: string, kidColor: 'white' | 'black', maxPositions = 2000): ParsedRepertoire {
  const positions: ParsedPosition[] = [];
  const moves: ParsedMove[] = [];
  const seenFens = new Set<string>();

  function addPos(fen: string) {
    if (!seenFens.has(fen)) { seenFens.add(fen); positions.push({ fen }); }
  }

  try {
    const chess = new Chess();
    if (!chess.loadPgn(pgn, { sloppy: true })) return { positions: [], moves: [] };

    const history = chess.history({ verbose: true });
    const walker = new Chess();
    const startFen = walker.fen();
    addPos(startFen);

    let prevFen: string = startFen;
    for (const m of history) {
      walker.move(m.san);
      const afterFen = walker.fen();
      addPos(afterFen);
      const fenParts = afterFen.split(' ');
      const moveNum = parseInt(fenParts[5]);
      moves.push({
        from_fen: prevFen,
        to_fen: afterFen,
        san: m.san,
        move_number: moveNum,
        is_kid_turn: (m.color === 'w' ? 'white' : 'black') === kidColor
      });
      prevFen = afterFen;
    }

    if (positions.length > maxPositions) {
      return { positions: [], moves: [], error: `Too large: ${positions.length} positions (max ${maxPositions})` };
    }
    return { positions, moves };
  } catch (e: any) {
    return { positions: [], moves: [], error: e.message };
  }
}
```

- [ ] **Step 4: Run tests to confirm passing**

```bash
npm run test -- src/lib/pgn/parser.test.ts
```
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgn/ && git commit -m "feat(pgn): PGN parser with tests"
```

---

### Task 12: FSRS Wrapper

**Files:**
- Create: `src/lib/srs/fsrs.ts`
- Create: `src/lib/srs/fsrs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/srs/fsrs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { rateFromResult, scheduleReview } from './fsrs';

describe('rateFromResult', () => {
  it('wrong => again', () => expect(rateFromResult({ correct: false, usedHint: false, latencyMs: 1000 })).toBe('again'));
  it('hint used => again', () => expect(rateFromResult({ correct: true, usedHint: true, latencyMs: 1000 })).toBe('again'));
  it('>5s correct => hard', () => expect(rateFromResult({ correct: true, usedHint: false, latencyMs: 6000 })).toBe('hard'));
  it('2-5s correct => good', () => expect(rateFromResult({ correct: true, usedHint: false, latencyMs: 3000 })).toBe('good'));
  it('<2s correct => easy', () => expect(rateFromResult({ correct: true, usedHint: false, latencyMs: 1500 })).toBe('easy'));
});

describe('scheduleReview', () => {
  it('returns required FSRS output fields', () => {
    const out = scheduleReview({
      state: 'New', stability: 0, difficulty: 0, elapsed_days: 0,
      scheduled_days: 0, reps: 0, lapses: 0, last_review: null, rating: 'good'
    });
    expect(out).toHaveProperty('due_at');
    expect(out).toHaveProperty('stability');
    expect(out).toHaveProperty('state');
    expect(out).toHaveProperty('reps');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- src/lib/srs/fsrs.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/srs/fsrs.ts`:

```typescript
import { FSRS, generatorParameters, createEmptyCard, type Rating } from 'ts-fsrs';

export type FsrsRating = 'again' | 'hard' | 'good' | 'easy';

export function rateFromResult(input: { correct: boolean; usedHint: boolean; latencyMs: number }): FsrsRating {
  if (!input.correct || input.usedHint) return 'again';
  if (input.latencyMs > 5000) return 'hard';
  if (input.latencyMs >= 2000) return 'good';
  return 'easy';
}

export interface ReviewInput {
  state: string; stability: number; difficulty: number; elapsed_days: number;
  scheduled_days: number; reps: number; lapses: number; last_review: string | null;
  rating: FsrsRating;
}

export interface ReviewOutput {
  due_at: string; stability: number; difficulty: number; elapsed_days: number;
  scheduled_days: number; reps: number; lapses: number; state: string;
}

const fsrs = new FSRS(generatorParameters({ request_retention: 0.9 }));
const RATING_MAP: Record<FsrsRating, Rating> = { again: 1, hard: 2, good: 3, easy: 4 };

export function scheduleReview(input: ReviewInput): ReviewOutput {
  const card = createEmptyCard() as any;
  card.state = input.state;
  card.stability = input.stability;
  card.difficulty = input.difficulty;
  card.elapsed_days = input.elapsed_days;
  card.scheduled_days = input.scheduled_days;
  card.reps = input.reps;
  card.lapses = input.lapses;
  card.last_review = input.last_review ? new Date(input.last_review) : null;

  const schedulingCards = fsrs.repeat(card, new Date());
  const result = schedulingCards[RATING_MAP[input.rating]].card;
  return {
    due_at: result.due.toISOString(),
    stability: result.stability,
    difficulty: result.difficulty,
    elapsed_days: result.elapsed_days,
    scheduled_days: result.scheduled_days,
    reps: result.reps,
    lapses: result.lapses,
    state: String(result.state)
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- src/lib/srs/fsrs.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs/ && git commit -m "feat(srs): FSRS wrapper with rating-from-latency logic"
```

---

### Task 13: Review Queue Builder

**Files:**
- Create: `src/lib/srs/queue.ts`
- Create: `src/lib/srs/queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/srs/queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildQueue, type ReviewCard } from './queue';

const past   = new Date(Date.now() - 86400000).toISOString();
const future = new Date(Date.now() + 86400000).toISOString();
const now    = new Date().toISOString();

const overdue:  ReviewCard = { id: 'r1', move_id: 'm1', state: 'Review',   due_at: past,   reps: 5 };
const learning: ReviewCard = { id: 'r2', move_id: 'm2', state: 'Learning', due_at: past,   reps: 1 };
const newCard:  ReviewCard = { id: 'r3', move_id: 'm3', state: 'New',      due_at: now,    reps: 0 };
const notDue:   ReviewCard = { id: 'r4', move_id: 'm4', state: 'Review',   due_at: future, reps: 3 };

describe('buildQueue', () => {
  it('orders overdue -> learning -> new', () => {
    const q = buildQueue([newCard, overdue, learning, notDue], { dailyGoal: 10, doneToday: 0 });
    expect(q[0].id).toBe('r1');
    expect(q[1].id).toBe('r2');
    expect(q[2].id).toBe('r3');
  });

  it('excludes future-due review cards', () => {
    const q = buildQueue([overdue, notDue], { dailyGoal: 10, doneToday: 0 });
    expect(q.find(c => c.id === 'r4')).toBeUndefined();
  });

  it('caps new cards by daily goal remainder', () => {
    const extras = [
      newCard,
      { ...newCard, id: 'r5', move_id: 'm5' },
      { ...newCard, id: 'r6', move_id: 'm6' }
    ];
    const q = buildQueue(extras, { dailyGoal: 2, doneToday: 1 });
    expect(q.filter(c => c.state === 'New').length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- src/lib/srs/queue.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/srs/queue.ts`:

```typescript
export interface ReviewCard {
  id: string; move_id: string; state: string; due_at: string; reps: number;
}

export interface QueueOptions { dailyGoal: number; doneToday: number; }

export function buildQueue(cards: ReviewCard[], opts: QueueOptions): ReviewCard[] {
  const now = new Date();
  const newBudget = Math.max(0, opts.dailyGoal - opts.doneToday);
  const overdue  = cards.filter(c => c.state === 'Review'   && new Date(c.due_at) <= now)
                        .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const learning = cards.filter(c => c.state === 'Learning' && new Date(c.due_at) <= now)
                        .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const newCards = cards.filter(c => c.state === 'New').slice(0, newBudget);
  return [...overdue, ...learning, ...newCards];
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- src/lib/srs/queue.test.ts
```
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs/ && git commit -m "feat(srs): review queue builder with daily cap"
```

---

### Task 14: XP Math

**Files:**
- Create: `src/lib/srs/xp.ts`
- Create: `src/lib/srs/xp.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/srs/xp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { xpForResult, levelFromXp, xpToNextLevel } from './xp';

describe('xpForResult', () => {
  it('+10 for correct first try', () => expect(xpForResult({ correct: true,  usedHint: false })).toBe(10));
  it('+5 for hint-assisted correct', () => expect(xpForResult({ correct: true,  usedHint: true  })).toBe(5));
  it('-2 for wrong',                () => expect(xpForResult({ correct: false, usedHint: false })).toBe(-2));
});

describe('levelFromXp', () => {
  it('level 1 at 0',    () => expect(levelFromXp(0)).toBe(1));
  it('level 2 at 100',  () => expect(levelFromXp(100)).toBe(2));
  it('level 3 at 250',  () => expect(levelFromXp(250)).toBe(3));
  it('level 4 at 500',  () => expect(levelFromXp(500)).toBe(4));
  it('level 5 at 1000', () => expect(levelFromXp(1000)).toBe(5));
  it('level 1 at 50',   () => expect(levelFromXp(50)).toBe(1));
});

describe('xpToNextLevel', () => {
  it('needs 100 xp at level 1 with 0 xp', () => expect(xpToNextLevel(1, 0)).toBe(100));
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test -- src/lib/srs/xp.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/srs/xp.ts`:

```typescript
export function xpForResult(input: { correct: boolean; usedHint: boolean }): number {
  if (!input.correct) return -2;
  return input.usedHint ? 5 : 10;
}

const FIXED_THRESHOLDS = [0, 100, 250, 500, 1000];

function thresholdForLevel(n: number): number {
  if (n < FIXED_THRESHOLDS.length) return FIXED_THRESHOLDS[n];
  let prev = FIXED_THRESHOLDS[FIXED_THRESHOLDS.length - 1];
  for (let i = FIXED_THRESHOLDS.length; i <= n; i++) {
    prev = Math.round((prev * 1.6) / 50) * 50;
  }
  return prev;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= thresholdForLevel(level)) level++;
  return level - 1;
}

export function xpToNextLevel(level: number, currentXp: number): number {
  return thresholdForLevel(level) - currentXp;
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- src/lib/srs/xp.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs/ && git commit -m "feat(srs): XP math and level curve"
```

---

### Task 15: ChessBoard Component

**Files:**
- Create: `src/lib/board/ChessBoard.svelte`
- Create: `src/lib/board/types.ts`
- Modify: `src/app.css`

- [ ] **Step 1: Add chessground CSS**

Append to `src/app.css`:

```css
@import 'chessground/assets/chessground.base.css';
@import 'chessground/assets/chessground.brown.css';
@import 'chessground/assets/chessground.cburnett.css';
```

- [ ] **Step 2: Board types**

Create `src/lib/board/types.ts`:

```typescript
export type Color = 'white' | 'black';

export interface BoardMove {
  from: string; // square notation: 'e2'
  to: string;
  san: string;
  promotion?: string;
}
```

- [ ] **Step 3: ChessBoard component**

Create `src/lib/board/ChessBoard.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chessground } from 'chessground';
  import type { Api } from 'chessground/api';
  import type { Color, BoardMove } from './types';

  export let fen: string;
  export let orientation: Color = 'white';
  export let allowedMoves: BoardMove[] = [];
  export let onMove: (move: BoardMove) => void = () => {};
  export let lastMove: [string, string] | null = null;

  let el: HTMLElement;
  let cg: Api;

  function buildDests(): Map<string, string[]> {
    const dests = new Map<string, string[]>();
    for (const m of allowedMoves) {
      const list = dests.get(m.from) ?? [];
      list.push(m.to);
      dests.set(m.from, list);
    }
    return dests;
  }

  onMount(() => {
    cg = Chessground(el, {
      fen,
      orientation,
      turnColor: orientation,
      movable: {
        free: false,
        color: allowedMoves.length > 0 ? orientation : undefined,
        dests: buildDests(),
        events: {
          after: (orig, dest) => {
            const move = allowedMoves.find(m => m.from === orig && m.to === dest);
            if (move) onMove(move);
          }
        }
      },
      highlight: { lastMove: true, check: true },
      lastMove: lastMove ?? undefined,
      premovable: { enabled: false }
    });
  });

  $: if (cg) {
    cg.set({
      fen,
      orientation,
      movable: {
        color: allowedMoves.length > 0 ? orientation : undefined,
        dests: buildDests()
      },
      lastMove: lastMove ?? undefined
    });
  }

  onDestroy(() => cg?.destroy());
</script>

<div bind:this={el} class="w-full aspect-square rounded-2xl overflow-hidden shadow-2xl"></div>
```

- [ ] **Step 4: Verify build**

```bash
npm run check
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/board/ src/app.css && git commit -m "feat(board): ChessBoard component with chessground"
```

---

### Task 16: PGN Upload UI + Edge Function

**Files:**
- Create: `src/routes/(kid)/repertoires/new/+page.svelte`
- Create: `src/routes/(kid)/repertoires/new/+page.server.ts`
- Create: `supabase/functions/pgn-parse/index.ts`

- [ ] **Step 1: Create Storage bucket**

In Supabase dashboard -> Storage -> New bucket: name `pgns`, private (not public).

- [ ] **Step 2: Create Edge Function**

Create `supabase/functions/pgn-parse/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { storagePath, repertoireId, kidColor } = await req.json();
  if (!storagePath || !repertoireId || !kidColor) {
    return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 });
  }

  const { data: blob } = await supabase.storage.from('pgns').download(storagePath);
  if (!blob) return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
  const pgn = await blob.text();

  // Parse PGN moves (linear, Phase A)
  const moveTokens: string[] = [];
  for (const line of pgn.split('\n')) {
    if (line.startsWith('[') || line.trim() === '') continue;
    for (const tok of line.trim().split(/\s+/)) {
      if (/^\d+\./.test(tok) || ['*', '1-0', '0-1', '1/2-1/2'].includes(tok)) continue;
      moveTokens.push(tok);
    }
  }

  if (moveTokens.length > 2000) {
    return new Response(JSON.stringify({ error: 'PGN too large' }), { status: 400 });
  }

  // Walk moves with chess.js (imported from ESM)
  const { Chess } = await import('https://esm.sh/chess.js@1');
  const chess = new Chess();
  const posMap: Record<string, string> = {};

  async function upsertPos(fen: string): Promise<string> {
    if (posMap[fen]) return posMap[fen];
    const { data } = await supabase.from('positions')
      .upsert({ fen }, { onConflict: 'fen' }).select('id').single();
    posMap[fen] = data!.id;
    return data!.id;
  }

  let prevId = await upsertPos(chess.fen());

  for (const san of moveTokens) {
    try {
      const m = chess.move(san);
      if (!m) continue;
      const afterFen = chess.fen();
      const toId = await upsertPos(afterFen);
      const fenParts = afterFen.split(' ');
      const moveNum = parseInt(fenParts[5]);

      const { data: mv } = await supabase.from('moves').upsert({
        repertoire_id: repertoireId,
        from_position: prevId,
        to_position: toId,
        san: m.san,
        move_number: moveNum,
        is_kid_turn: (m.color === 'w' ? 'white' : 'black') === kidColor
      }, { onConflict: 'repertoire_id,from_position,san' }).select('id').single();

      if (mv) {
        await supabase.from('reviews').upsert(
          { kid_id: user.id, move_id: mv.id },
          { onConflict: 'kid_id,move_id' }
        );
      }
      prevId = toId;
    } catch {}
  }

  await supabase.from('repertoires').update({ is_draft: false }).eq('id', repertoireId);
  return new Response(JSON.stringify({ ok: true, movesAdded: moveTokens.length }));
});
```

- [ ] **Step 3: Deploy Edge Function**

```bash
npx supabase functions deploy pgn-parse --no-verify-jwt
```
Expected: Deployed successfully.

- [ ] **Step 4: Upload page server**

Create `src/routes/(kid)/repertoires/new/+page.server.ts`:

```typescript
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
  upload: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401);
    const data = await request.formData();
    const file = data.get('pgn') as File;
    const name = data.get('name') as string;
    const color = data.get('color') as string;
    if (!file || !name || !color) return fail(400, { error: 'All fields required' });

    const { data: rep, error: repErr } = await supabase.from('repertoires')
      .insert({ kid_id: user.id, name, color, is_draft: true }).select().single();
    if (repErr) return fail(500, { error: repErr.message });

    const path = `${user.id}/${rep.id}.pgn`;
    const { error: storeErr } = await supabase.storage.from('pgns').upload(path, file);
    if (storeErr) return fail(500, { error: storeErr.message });

    const { error: fnErr } = await supabase.functions.invoke('pgn-parse', {
      body: { storagePath: path, repertoireId: rep.id, kidColor: color }
    });
    if (fnErr) return fail(500, { error: fnErr.message });

    throw redirect(303, '/repertoires');
  }
};
```

- [ ] **Step 5: Upload page UI**

Create `src/routes/(kid)/repertoires/new/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  export let form: any;
  let color = 'white';
  let dragging = false;
  let fileName = '';

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    fileName = input.files?.[0]?.name ?? '';
  }
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
  <a href="/repertoires" class="text-slate-400 text-sm mb-4 block">Back</a>
  <h1 class="text-3xl font-bold text-yellow-400 mb-6">New Repertoire</h1>
  {#if form?.error}<p class="text-red-400 mb-4 bg-red-900/20 p-3 rounded-xl">{form.error}</p>{/if}
  <form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance class="space-y-4">
    <label class="flex flex-col gap-1">
      <span class="text-slate-400 text-sm">Name</span>
      <input name="name" required
        class="bg-slate-800 rounded-xl px-4 py-3 border border-slate-600 text-white" />
    </label>
    <div class="flex gap-3">
      {#each ['white', 'black'] as c}
        <button type="button" on:click={() => color = c}
          class="flex-1 py-3 rounded-xl font-semibold transition
            {color === c ? 'bg-yellow-400 text-slate-900' : 'bg-slate-700 text-white'}">
          Playing as {c}
        </button>
      {/each}
    </div>
    <input type="hidden" name="color" value={color} />
    <label
      class="flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-10 cursor-pointer transition
        {dragging ? 'border-yellow-400 bg-slate-800' : 'border-slate-600 hover:border-slate-400'}"
      on:dragenter={() => dragging = true}
      on:dragleave={() => dragging = false}
      on:drop={() => dragging = false}
    >
      <span class="text-5xl mb-3">📂</span>
      <span class="text-slate-400 text-sm">{fileName || 'Drag PGN here or click to browse'}</span>
      <input type="file" name="pgn" accept=".pgn" class="sr-only" on:change={onFileChange} />
    </label>
    <button type="submit"
      class="w-full bg-yellow-400 text-slate-900 py-4 rounded-2xl font-bold text-lg hover:bg-yellow-300 transition">
      Upload & Import
    </button>
  </form>
</main>
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/(kid)/repertoires/new/ supabase/functions/ && git commit -m "feat: PGN upload UI and Edge Function"
```

---

### Task 17: Repertoire List Page

**Files:**
- Create: `src/routes/(kid)/repertoires/+page.svelte`
- Create: `src/routes/(kid)/repertoires/+page.server.ts`

- [ ] **Step 1: Server load**

Create `src/routes/(kid)/repertoires/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: repertoires } = await supabase
    .from('repertoires')
    .select('*, moves(count)')
    .eq('kid_id', user!.id)
    .eq('is_draft', false)
    .order('created_at', { ascending: false });
  return { repertoires: repertoires ?? [] };
};
```

- [ ] **Step 2: Page UI**

Create `src/routes/(kid)/repertoires/+page.svelte`:

```svelte
<script lang="ts">
  export let data: { repertoires: any[] };
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-2xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold text-yellow-400">My Repertoires</h1>
    <a href="/repertoires/new" class="bg-yellow-400 text-slate-900 px-4 py-2 rounded-xl font-semibold">+ Add</a>
  </div>
  {#if data.repertoires.length === 0}
    <div class="text-center py-20 text-slate-400">
      <p class="text-6xl mb-4">♟️</p>
      <p class="text-xl">No repertoires yet. Upload a PGN to start!</p>
      <a href="/repertoires/new" class="mt-4 inline-block bg-yellow-400 text-slate-900 px-6 py-3 rounded-xl font-bold">Upload PGN</a>
    </div>
  {:else}
    <ul class="space-y-3">
      {#each data.repertoires as rep}
        <li class="bg-slate-800 rounded-2xl p-5 flex justify-between items-center">
          <div>
            <p class="font-bold text-lg">{rep.name}</p>
            <p class="text-slate-400 text-sm capitalize">{rep.color} • {rep.moves?.[0]?.count ?? 0} moves</p>
          </div>
          <div class="flex gap-2">
            <a href="/learn/{rep.id}" class="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-green-400">Learn</a>
            <a href="/practice/{rep.id}" class="bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-400">Practice</a>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/(kid)/repertoires/ && git commit -m "feat: repertoire list page"
```

---

### Task 18: Learn Mode Session

**Files:**
- Create: `src/routes/(kid)/learn/[repertoireId]/+page.svelte`
- Create: `src/routes/(kid)/learn/[repertoireId]/+page.server.ts`
- Create: `src/lib/board/sessionHelpers.ts`

- [ ] **Step 1: Session helper (compute from/to squares from FEN)**

Create `src/lib/board/sessionHelpers.ts`:

```typescript
import { Chess } from 'chess.js';
import type { BoardMove } from './types';

/** Given the position FEN before a move and the SAN, returns {from, to} squares */
export function moveToSquares(positionFen: string, san: string): { from: string; to: string } | null {
  const chess = new Chess(positionFen);
  const moves = chess.moves({ verbose: true });
  const m = moves.find(mv => mv.san === san);
  if (!m) return null;
  return { from: m.from, to: m.to };
}

export function buildBoardMove(positionFen: string, san: string): BoardMove | null {
  const squares = moveToSquares(positionFen, san);
  if (!squares) return null;
  return { ...squares, san };
}
```

- [ ] **Step 2: Learn session server**

Create `src/routes/(kid)/learn/[repertoireId]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: rep } = await supabase.from('repertoires').select('*')
    .eq('id', params.repertoireId).eq('kid_id', user!.id).single();

  const { data: cards } = await supabase.from('reviews')
    .select(`*, moves!inner(
      id, san, move_number, is_kid_turn,
      from_pos:positions!from_position(fen),
      to_pos:positions!to_position(fen)
    )`)
    .eq('kid_id', user!.id)
    .eq('moves.repertoire_id', params.repertoireId)
    .eq('state', 'New')
    .limit(20);

  const { data: profile } = await supabase.from('profiles')
    .select('daily_goal, xp, level, streak_days').eq('id', user!.id).single();

  return { rep, cards: cards ?? [], profile, userId: user!.id };
};
```

- [ ] **Step 3: Learn session UI**

Create `src/routes/(kid)/learn/[repertoireId]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import ChessBoard from '$lib/board/ChessBoard.svelte';
  import { rateFromResult, scheduleReview } from '$lib/srs/fsrs';
  import { xpForResult } from '$lib/srs/xp';
  import { buildBoardMove } from '$lib/board/sessionHelpers';
  import { createSupabaseClient } from '$lib/supabase/client';

  export let data: any;
  const sb = createSupabaseClient();

  let cards = [...data.cards];
  let idx = 0;
  let sessionId = '';
  let events: any[] = [];
  let cardStart = 0;
  let showHint = false;
  let hintTimer: ReturnType<typeof setTimeout>;
  let feedback: 'correct' | 'wrong' | null = null;
  let done = false;
  let xpEarned = 0;

  $: card = cards[idx];
  $: fen = card?.moves?.from_pos?.fen ?? '';
  $: expectedMove = card ? buildBoardMove(fen, card.moves.san) : null;

  onMount(async () => {
    if (!cards.length) { done = true; return; }
    const { data: s } = await sb.from('sessions').insert({
      kid_id: data.userId, repertoire_id: data.rep.id, mode: 'learn'
    }).select('id').single();
    sessionId = s.id;
    startCard();
  });

  function startCard() {
    cardStart = Date.now();
    feedback = null;
    showHint = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => showHint = true, 5000);
  }

  async function handleMove(move: any) {
    clearTimeout(hintTimer);
    const correct = move.san === card.moves.san;
    const latencyMs = Date.now() - cardStart;
    const rating = rateFromResult({ correct, usedHint: showHint, latencyMs });
    const xpDelta = xpForResult({ correct, usedHint: showHint });
    const scheduled = scheduleReview({ ...card, rating });
    feedback = correct ? 'correct' : 'wrong';
    xpEarned += Math.max(0, xpDelta);
    events.push({ move_id: card.moves.id, rating, latency_ms: latencyMs,
                  used_hint: showHint, xp_delta: xpDelta, ...scheduled });

    setTimeout(async () => {
      if (!correct) cards.push(card);
      idx++;
      if (idx >= cards.length) {
        await sb.rpc('submit_session_result', { p_session_id: sessionId, p_events: events });
        done = true;
      } else { startCard(); }
    }, 800);
  }
</script>

{#if done}
  <div class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-6 p-6">
    <span class="text-8xl">🎉</span>
    <h1 class="text-3xl font-bold text-yellow-400">Session Complete!</h1>
    <p class="text-slate-400">+{xpEarned} XP earned</p>
    <a href="/repertoires" class="bg-yellow-400 text-slate-900 px-8 py-4 rounded-2xl font-bold">Back to Repertoires</a>
  </div>
{:else if !cards.length}
  <div class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4">
    <span class="text-6xl">✅</span>
    <h1 class="text-2xl font-bold">Nothing new to learn!</h1>
    <a href="/practice/{data.rep.id}" class="bg-blue-500 text-white px-6 py-3 rounded-xl font-bold">Go to Practice</a>
  </div>
{:else}
  <main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto flex flex-col gap-4">
    <div class="flex justify-between items-center text-sm text-slate-400">
      <a href="/repertoires">Back</a>
      <span>{idx + 1} / {cards.length}</span>
    </div>
    <div class="relative">
      <ChessBoard
        {fen}
        orientation={data.rep.color}
        allowedMoves={expectedMove ? [expectedMove] : []}
        onMove={handleMove}
      />
      {#if feedback}
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span class="text-7xl drop-shadow-lg">{feedback === 'correct' ? '✅' : '❌'}</span>
        </div>
      {/if}
    </div>
    {#if showHint && card}
      <div class="bg-slate-800 rounded-2xl p-4 text-center animate-pulse">
        <p class="text-yellow-400 font-bold text-lg">Hint: play <strong>{card.moves.san}</strong></p>
      </div>
    {/if}
  </main>
{/if}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/(kid)/learn/ src/lib/board/sessionHelpers.ts && git commit -m "feat: Learn mode training session"
```

---

### Task 19: Practice Mode Session

**Files:**
- Create: `src/routes/(kid)/practice/[repertoireId]/+page.svelte`
- Create: `src/routes/(kid)/practice/[repertoireId]/+page.server.ts`

- [ ] **Step 1: Practice server (FSRS due queue)**

Create `src/routes/(kid)/practice/[repertoireId]/+page.server.ts`:

```typescript
import { buildQueue } from '$lib/srs/queue';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: rep } = await supabase.from('repertoires').select('*')
    .eq('id', params.repertoireId).eq('kid_id', user!.id).single();
  const { data: profile } = await supabase.from('profiles')
    .select('daily_goal, xp, level, streak_days').eq('id', user!.id).single();

  const { data: allReviews } = await supabase.from('reviews')
    .select(`id, move_id, state, due_at, reps,
      moves!inner(id, san, is_kid_turn,
        from_pos:positions!from_position(fen),
        to_pos:positions!to_position(fen)
      )`)
    .eq('kid_id', user!.id)
    .eq('moves.repertoire_id', params.repertoireId);

  const { data: todaySessions } = await supabase.from('sessions')
    .select('cards_done').eq('kid_id', user!.id)
    .gte('started_at', new Date().toISOString().split('T')[0]);

  const doneToday = (todaySessions ?? []).reduce((s: number, x: any) => s + (x.cards_done ?? 0), 0);
  const queue = buildQueue(allReviews ?? [], { dailyGoal: profile?.daily_goal ?? 10, doneToday });

  return { rep, cards: queue, profile, userId: user!.id };
};
```

- [ ] **Step 2: Practice session UI**

Create `src/routes/(kid)/practice/[repertoireId]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import ChessBoard from '$lib/board/ChessBoard.svelte';
  import { rateFromResult, scheduleReview } from '$lib/srs/fsrs';
  import { xpForResult } from '$lib/srs/xp';
  import { buildBoardMove } from '$lib/board/sessionHelpers';
  import { createSupabaseClient } from '$lib/supabase/client';

  export let data: any;
  const sb = createSupabaseClient();

  let cards = [...data.cards];
  let idx = 0;
  let sessionId = '';
  let events: any[] = [];
  let cardStart = 0;
  let showHint = false;
  let feedback: 'correct' | 'wrong' | null = null;
  let done = false;

  $: card = cards[idx];
  $: fen = card?.moves?.from_pos?.fen ?? '';
  $: expectedMove = card ? buildBoardMove(fen, card.moves.san) : null;

  onMount(async () => {
    if (!cards.length) { done = true; return; }
    const { data: s } = await sb.from('sessions').insert({
      kid_id: data.userId, repertoire_id: data.rep.id, mode: 'practice'
    }).select('id').single();
    sessionId = s.id;
    startCard();
  });

  function startCard() {
    cardStart = Date.now();
    feedback = null;
    showHint = false;
  }

  async function handleMove(move: any) {
    const correct = move.san === card.moves.san;
    const latencyMs = Date.now() - cardStart;
    const rating = rateFromResult({ correct, usedHint: showHint, latencyMs });
    const xpDelta = xpForResult({ correct, usedHint: showHint });
    const scheduled = scheduleReview({ ...card, rating });
    feedback = correct ? 'correct' : 'wrong';

    events.push({ move_id: card.moves.id, rating, latency_ms: latencyMs,
                  used_hint: showHint, xp_delta: xpDelta, ...scheduled });

    setTimeout(async () => {
      if (!correct) cards.splice(idx + 1, 0, card);
      idx++;
      if (idx >= cards.length) {
        await sb.rpc('submit_session_result', { p_session_id: sessionId, p_events: events });
        done = true;
      } else { startCard(); }
    }, 800);
  }
</script>

{#if done}
  <div class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-6">
    <span class="text-8xl">🌟</span>
    <h1 class="text-3xl font-bold text-yellow-400">Practice Complete!</h1>
    <p class="text-slate-400">{events.length} cards reviewed</p>
    <a href="/" class="bg-yellow-400 text-slate-900 px-8 py-4 rounded-2xl font-bold">Home</a>
  </div>
{:else if !cards.length}
  <div class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4">
    <span class="text-6xl">🌟</span>
    <h1 class="text-2xl font-bold">All caught up!</h1>
    <a href="/" class="bg-slate-700 text-white px-6 py-3 rounded-xl font-bold">Home</a>
  </div>
{:else}
  <main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto flex flex-col gap-4">
    <div class="flex justify-between items-center text-sm text-slate-400">
      <a href="/repertoires">Back</a>
      <span>{idx + 1} / {cards.length}</span>
    </div>
    <div class="relative">
      <ChessBoard
        {fen}
        orientation={data.rep.color}
        allowedMoves={expectedMove ? [expectedMove] : []}
        onMove={handleMove}
      />
      {#if feedback}
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span class="text-7xl drop-shadow-lg">{feedback === 'correct' ? '✅' : '❌'}</span>
        </div>
      {/if}
    </div>
    <button on:click={() => showHint = true}
      class="w-full bg-slate-700 text-white py-3 rounded-xl font-semibold hover:bg-slate-600 transition">
      Show Hint (-5 XP)
    </button>
    {#if showHint && card}
      <p class="text-center text-yellow-400 font-bold text-lg">Play: {card.moves.san}</p>
    {/if}
  </main>
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/(kid)/practice/ && git commit -m "feat: Practice mode training session"
```

---

### Task 20: Gamification UI Components

**Files:**
- Create: `src/lib/components/StreakBadge.svelte`
- Create: `src/lib/components/DailyGoalRing.svelte`
- Create: `src/lib/components/XpBar.svelte`
- Create: `src/lib/components/SirKnight.svelte`

- [ ] **Step 1: StreakBadge**

Create `src/lib/components/StreakBadge.svelte`:

```svelte
<script lang="ts">
  export let streakDays: number = 0;
  export let freezes: number = 0;
</script>
<div class="flex items-center gap-2 bg-slate-800 rounded-full px-4 py-2 select-none">
  <span class="text-2xl" aria-hidden="true">🔥</span>
  <span class="font-bold text-orange-400 text-lg">{streakDays}</span>
  {#if freezes > 0}
    <span class="text-blue-400 text-sm" title="{freezes} streak freeze(s) available">❄️×{freezes}</span>
  {/if}
</div>
```

- [ ] **Step 2: DailyGoalRing**

Create `src/lib/components/DailyGoalRing.svelte`:

```svelte
<script lang="ts">
  export let done: number = 0;
  export let goal: number = 10;
  const r = 40;
  const circ = 2 * Math.PI * r;
  $: pct = Math.min(1, done / Math.max(1, goal));
  $: offset = circ * (1 - pct);
</script>
<div class="flex flex-col items-center gap-1">
  <svg width="100" height="100" class="-rotate-90" aria-label="{done} of {goal} cards done today">
    <circle cx="50" cy="50" r={r} stroke="#334155" stroke-width="10" fill="none" />
    <circle cx="50" cy="50" r={r} stroke="#facc15" stroke-width="10" fill="none"
      stroke-dasharray={circ} stroke-dashoffset={offset}
      stroke-linecap="round" style="transition: stroke-dashoffset 0.5s ease" />
  </svg>
  <span class="text-sm text-slate-400">{done}/{goal} today</span>
</div>
```

- [ ] **Step 3: XpBar**

Create `src/lib/components/XpBar.svelte`:

```svelte
<script lang="ts">
  import { levelFromXp, xpToNextLevel } from '$lib/srs/xp';
  export let xp: number = 0;
  $: level = levelFromXp(xp);
  $: toNext = xpToNextLevel(level, xp);
  $: pct = Math.min(100, ((xp - (xp - (xp - toNext + toNext))) / (toNext || 1)) * 100);

  // Compute pct: how much of the current level's range we've filled
  // range = thresholdForLevel(level) - thresholdForLevel(level-1)
  // filled = xp - thresholdForLevel(level-1)
  import { xpToNextLevel as xpTo } from '$lib/srs/xp';
  $: filled = xp - (xp + toNext - xpTo(level - 1 > 0 ? level - 1 : 0, 0));
</script>

<div class="flex items-center gap-3 w-full" aria-label="Level {level}, {toNext} XP to next level">
  <span class="text-yellow-400 font-bold text-sm w-16 shrink-0">Lv {level}</span>
  <div class="flex-1 bg-slate-700 rounded-full h-3 overflow-hidden">
    <div class="h-full bg-yellow-400 rounded-full transition-all duration-300"
      style="width: {Math.max(5, Math.min(100, (1 - toNext / (toNext + (xp - 0))) * 100))}%">
    </div>
  </div>
  <span class="text-slate-400 text-sm w-20 text-right shrink-0">{xp} XP</span>
</div>
```

> Note: XpBar's progress percentage calculation is a visual approximation. Refine with the exact level threshold range in Phase B.

- [ ] **Step 4: SirKnight mascot**

Create `src/lib/components/SirKnight.svelte`:

```svelte
<script lang="ts">
  export type Expression = 'idle' | 'cheer' | 'sad' | 'surprise' | 'sleepy' | 'party';
  export let expression: Expression = 'idle';

  const FACES: Record<Expression, string> = {
    idle:     '♟️',
    cheer:    '🎉',
    sad:      '😢',
    surprise: '😲',
    sleepy:   '😴',
    party:    '🥳'
  };
</script>
<div class="flex flex-col items-center select-none" role="img" aria-label="Sir Knight is {expression}">
  <span class="text-8xl transition-all duration-300">{FACES[expression]}</span>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ && git commit -m "feat(ui): StreakBadge, DailyGoalRing, XpBar, SirKnight gamification components"
```

---

### Task 21: Kid Home Screen

**Files:**
- Create: `src/routes/(kid)/+page.svelte`
- Create: `src/routes/(kid)/+page.server.ts`

- [ ] **Step 1: Server load**

Create `src/routes/(kid)/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: profile } = await supabase.from('profiles')
    .select('*, kid_stats(*), equipped_cosmetics(*)').eq('id', user!.id).single();
  const { data: sessions } = await supabase.from('sessions')
    .select('cards_done').eq('kid_id', user!.id)
    .gte('started_at', new Date().toISOString().split('T')[0]);
  const doneToday = (sessions ?? []).reduce((s: number, x: any) => s + (x.cards_done ?? 0), 0);
  return { profile, doneToday };
};
```

- [ ] **Step 2: Home screen UI**

Create `src/routes/(kid)/+page.svelte`:

```svelte
<script lang="ts">
  import StreakBadge from '$lib/components/StreakBadge.svelte';
  import DailyGoalRing from '$lib/components/DailyGoalRing.svelte';
  import XpBar from '$lib/components/XpBar.svelte';
  import SirKnight from '$lib/components/SirKnight.svelte';
  import type { Expression } from '$lib/components/SirKnight.svelte';

  export let data: { profile: any; doneToday: number };
  $: goalMet = data.doneToday >= (data.profile?.daily_goal ?? 10);
  $: expression = (goalMet ? 'cheer' : data.doneToday > 0 ? 'idle' : 'idle') as Expression;
</script>

<main class="min-h-screen bg-slate-900 text-white flex flex-col items-center gap-6 p-6 max-w-lg mx-auto">
  <div class="flex justify-between w-full items-center">
    <h1 class="text-2xl font-bold text-yellow-400">Hi, {data.profile?.display_name}!</h1>
    <StreakBadge
      streakDays={data.profile?.streak_days ?? 0}
      freezes={data.profile?.streak_freeze ?? 0} />
  </div>
  <XpBar xp={data.profile?.xp ?? 0} />
  <SirKnight {expression} />
  <DailyGoalRing done={data.doneToday} goal={data.profile?.daily_goal ?? 10} />
  <a href="/repertoires"
    class="w-full bg-yellow-400 text-slate-900 py-5 rounded-2xl font-bold text-xl text-center shadow-lg hover:bg-yellow-300 transition">
    {goalMet ? '🌟 Keep Going!' : '▶ Start Training'}
  </a>
  <nav class="flex gap-3 w-full">
    <a href="/repertoires" class="flex-1 bg-slate-800 rounded-xl py-3 text-center text-sm hover:bg-slate-700">Repertoires</a>
    <a href="/badges" class="flex-1 bg-slate-800 rounded-xl py-3 text-center text-sm hover:bg-slate-700">Badges</a>
    <a href="/settings" class="flex-1 bg-slate-800 rounded-xl py-3 text-center text-sm hover:bg-slate-700">Settings</a>
  </nav>
</main>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/(kid)/ && git commit -m "feat: kid home screen with all gamification widgets"
```

---

### Task 22: Coach Dashboard

**Files:**
- Create: `src/routes/(coach)/+page.svelte`
- Create: `src/routes/(coach)/+page.server.ts`
- Create: `src/routes/(coach)/kids/[id]/+page.svelte`
- Create: `src/routes/(coach)/kids/[id]/+page.server.ts`

- [ ] **Step 1: Coach overview server**

Create `src/routes/(coach)/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: kids } = await supabase.from('profiles')
    .select('id, display_name, level, xp, streak_days, kid_stats(*)')
    .eq('coach_id', user!.id).eq('role', 'kid');
  return { kids: kids ?? [] };
};
```

- [ ] **Step 2: Coach overview UI**

Create `src/routes/(coach)/+page.svelte`:

```svelte
<script lang="ts">
  export let data: { kids: any[] };
</script>
<main class="min-h-screen bg-slate-900 text-white p-6 max-w-2xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-3xl font-bold text-yellow-400">My Students</h1>
    <a href="/coach/invite" class="bg-yellow-400 text-slate-900 px-4 py-2 rounded-xl font-semibold">Invite</a>
  </div>
  {#if data.kids.length === 0}
    <div class="text-center py-20 text-slate-400">
      <p class="text-5xl mb-4">👩‍🏫</p>
      <p>No students yet. Send an invite to get started!</p>
    </div>
  {:else}
    <ul class="space-y-3">
      {#each data.kids as kid}
        <li class="bg-slate-800 rounded-2xl p-5">
          <a href="/coach/kids/{kid.id}" class="flex justify-between items-center">
            <div>
              <p class="font-bold text-lg">{kid.display_name}</p>
              <p class="text-slate-400 text-sm">Level {kid.level} • 🔥{kid.streak_days} days</p>
            </div>
            <div class="text-right text-sm text-slate-400">
              <p>{kid.kid_stats?.[0]?.total_reviews ?? 0} reviews</p>
              <p class="text-yellow-400 font-bold">{kid.xp} XP</p>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
```

- [ ] **Step 3: Kid detail server**

Create `src/routes/(coach)/kids/[id]/+page.server.ts`:

```typescript
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  const { data: kid } = await supabase.from('profiles')
    .select('*, kid_stats(*), badges_earned(badge_id, earned_at, badges(*))')
    .eq('id', params.id).eq('coach_id', user!.id).single();
  if (!kid) throw error(404, 'Student not found');

  const { data: reps } = await supabase.from('repertoires')
    .select('*, moves(count)').eq('kid_id', params.id).eq('is_draft', false);

  const { data: sessions } = await supabase.from('sessions')
    .select('mode, cards_done, xp_earned, started_at')
    .eq('kid_id', params.id).order('started_at', { ascending: false }).limit(10);

  return { kid, reps: reps ?? [], sessions: sessions ?? [] };
};
```

- [ ] **Step 4: Kid detail UI**

Create `src/routes/(coach)/kids/[id]/+page.svelte`:

```svelte
<script lang="ts">
  export let data: any;
</script>
<main class="min-h-screen bg-slate-900 text-white p-6 max-w-2xl mx-auto space-y-6">
  <a href="/coach" class="text-slate-400 text-sm">Back</a>
  <div class="bg-slate-800 rounded-2xl p-6">
    <h1 class="text-3xl font-bold text-yellow-400">{data.kid.display_name}</h1>
    <div class="grid grid-cols-3 gap-4 mt-4 text-center">
      <div><p class="text-2xl font-bold">{data.kid.level}</p><p class="text-slate-400 text-sm">Level</p></div>
      <div><p class="text-2xl font-bold text-yellow-400">{data.kid.xp}</p><p class="text-slate-400 text-sm">XP</p></div>
      <div><p class="text-2xl font-bold">🔥{data.kid.streak_days}</p><p class="text-slate-400 text-sm">Streak</p></div>
    </div>
  </div>
  <section>
    <h2 class="text-xl font-bold mb-3">Repertoires ({data.reps.length})</h2>
    <ul class="space-y-2">
      {#each data.reps as rep}
        <li class="bg-slate-800 rounded-xl p-4 flex justify-between">
          <span class="capitalize">{rep.name} ({rep.color})</span>
          <span class="text-slate-400 text-sm">{rep.moves?.[0]?.count ?? 0} moves</span>
        </li>
      {/each}
    </ul>
  </section>
  <section>
    <h2 class="text-xl font-bold mb-3">Recent Sessions</h2>
    <ul class="space-y-2">
      {#each data.sessions as s}
        <li class="bg-slate-800 rounded-xl p-4 flex justify-between text-sm">
          <span class="capitalize">{s.mode} — {s.cards_done} cards</span>
          <span class="text-yellow-400">+{s.xp_earned} XP</span>
        </li>
      {/each}
    </ul>
  </section>
</main>
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/(coach)/ && git commit -m "feat: coach dashboard with student detail view"
```

---

### Task 23: PWA Manifest + Service Worker

**Files:**
- Modify: `vite.config.ts`
- Create: `static/icons/icon-192.png` (placeholder)
- Create: `static/icons/icon-512.png` (placeholder)

- [ ] **Step 1: Update VitePWA config in vite.config.ts**

Replace the VitePWA plugin config:

```typescript
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
    runtimeCaching: [{
      urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'supabase-api',
        expiration: { maxEntries: 100, maxAgeSeconds: 3600 }
      }
    }]
  },
  manifest: {
    name: 'mychess',
    short_name: 'mychess',
    description: 'Learn chess openings. Have fun. Level up!',
    theme_color: '#1e293b',
    background_color: '#0f172a',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  }
})
```

- [ ] **Step 2: Create placeholder icons**

```bash
# Create minimal 1x1 PNG as placeholder
python3 -c "
import base64, os
os.makedirs('static/icons', exist_ok=True)
# Minimal 192x192 solid PNG (tiny valid PNG file)
data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
open('static/icons/icon-192.png','wb').write(data)
open('static/icons/icon-512.png','wb').write(data)
print('Placeholder icons created')
"
```

- [ ] **Step 3: Verify build generates service worker**

```bash
npm run build && ls .svelte-kit/output/client/ | grep -E 'sw|workbox'
```
Expected: `sw.js` present.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts static/icons/ && git commit -m "feat(pwa): PWA manifest and service worker"
```

---

### Task 24: E2E Tests

**Files:**
- Create: `tests/invite.test.ts`
- Create: `tests/upload.test.ts`

- [ ] **Step 1: Write invite flow tests**

Create `tests/invite.test.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('login page shows Google sign-in button', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Sign in with Google')).toBeVisible();
});

test('invalid token shows error message', async ({ page }) => {
  await page.goto('/join/this-token-does-not-exist');
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
});
```

- [ ] **Step 2: Write upload redirect test**

Create `tests/upload.test.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('upload page redirects unauthenticated user to login', async ({ page }) => {
  await page.goto('/repertoires/new');
  await expect(page).toHaveURL(/\/login/);
});

test('coach dashboard redirects unauthenticated user to login', async ({ page }) => {
  await page.goto('/coach');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Configure Playwright base URL in playwright.config.ts**

Edit `playwright.config.ts` to set baseURL:

```typescript
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
});
```

- [ ] **Step 4: Run Playwright tests**

```bash
npm run test:e2e
```
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/ playwright.config.ts && git commit -m "test(e2e): smoke tests for auth, invite, and upload routes"
```

---

### Task 25: Deploy to Vercel

**Files:** (no new files)

- [ ] **Step 1: Install Vercel adapter**

```bash
npm install -D @sveltejs/adapter-vercel
```

Edit `svelte.config.js`:

```javascript
import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() }
};
```

- [ ] **Step 2: Set up Vercel project**

```bash
npx vercel link
npx vercel env add PUBLIC_SUPABASE_URL production
npx vercel env add PUBLIC_SUPABASE_ANON_KEY production
```

- [ ] **Step 3: Deploy**

```bash
npx vercel --prod
```
Expected: Build passes, deployment URL printed (e.g., `https://mychess.vercel.app`).

- [ ] **Step 4: Smoke test checklist**

Open the deployment URL in a browser (and Chrome DevTools mobile emulation at 390px width):
- [ ] `/login` renders with Google button
- [ ] Google OAuth flow completes and lands on `/welcome`
- [ ] Role picker submits and redirects to `/` (kid) or `/coach`
- [ ] `/repertoires` shows empty state
- [ ] `/repertoires/new` shows PGN upload form
- [ ] PWA: Install prompt appears on mobile

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: Phase A complete -- mychess MVP ready"
```

---

## Self-Review: Spec vs Plan Coverage

| Spec Requirement | Tasks |
|---|---|
| Google OAuth login | 7, 9 |
| Kid/Coach role separation | 8, 9 |
| Coach invite system (token, 7-day expiry, single-use) | 10 |
| PGN upload from computer | 11, 16 |
| Repertoire tree (positions + moves table) | 3, 11, 16, 17 |
| FSRS v4 spaced repetition (90% retention) | 12 |
| Review queue: overdue -> learning -> new | 13 |
| XP: +10 correct, +5 hint, -2 wrong | 14 |
| Level curve (100/250/500/1000 then x1.6) | 14 |
| Streak with freeze (every 7th day, max 2) | 5 (RPC), 20, 21 |
| Daily goal ring | 20, 21 |
| Sir Knight mascot (6 expressions) | 20 |
| Learn mode (new cards, hint after 5s) | 18 |
| Practice mode (FSRS due queue, on-demand hint) | 19 |
| Kid home screen | 21 |
| Coach dashboard (view-only) | 22 |
| PWA + service worker | 23 |
| E2E smoke tests | 24 |
| Vercel deploy | 25 |

**Known Phase A omissions (intentional, Phase B):**
- chess.com / lichess game sync
- Drill mode and Time Trial mode
- Badge auto-award triggers (catalog seeded in Task 6)
- Avatar/theme shop UI (catalog seeded in Task 6)
- Full PGN variation tree (Task 11 covers linear games only)
- Leaderboard and quests
