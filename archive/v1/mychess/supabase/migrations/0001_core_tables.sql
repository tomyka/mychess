
create extension if not exists "pgcrypto";

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('player','coach')),
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
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.profiles(id),
  token       text not null unique default md5(gen_random_uuid()::text || now()::text),
  player_email   text,
  redeemed_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);

create table public.repertoires (
  id         uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  color      text not null check (color in ('white','black')),
  is_draft   boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.positions (
  id  uuid primary key default gen_random_uuid(),
  fen text not null unique
);

create table public.moves (
  id            uuid primary key default gen_random_uuid(),
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  from_position uuid references public.positions(id),
  to_position   uuid not null references public.positions(id),
  san           text not null,
  move_number   integer not null,
  is_player_turn   boolean not null,
  annotation    text,
  created_at    timestamptz not null default now(),
  unique (repertoire_id, from_position, san)
);

create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.profiles(id) on delete cascade,
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
  unique (player_id, move_id)
);

create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.profiles(id),
  repertoire_id uuid references public.repertoires(id),
  mode          text not null check (mode in ('learn','practice')),
  cards_done    integer not null default 0,
  xp_earned     integer not null default 0,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create table public.review_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  move_id    uuid not null references public.moves(id),
  rating     text not null check (rating in ('again','hard','good','easy')),
  latency_ms integer not null,
  used_hint  boolean not null default false,
  xp_delta   integer not null,
  created_at timestamptz not null default now()
);

create table public.player_stats (
  player_id        uuid primary key references public.profiles(id) on delete cascade,
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
  player_id    uuid references public.profiles(id) on delete cascade,
  badge_id  text references public.badges(id),
  earned_at timestamptz not null default now(),
  primary key (player_id, badge_id)
);

create table public.coach_notes (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.profiles(id),
  player_id     uuid not null references public.profiles(id),
  note       text not null,
  created_at timestamptz not null default now()
);

create table public.avatars   (id text primary key, name text, svg_url text);
create table public.themes    (id text primary key, name text, light_square text, dark_square text);
create table public.piece_sets(id text primary key, name text, sprite_url text);

create table public.equipped_cosmetics (
  player_id    uuid primary key references public.profiles(id) on delete cascade,
  avatar_id text references public.avatars(id) default 'knight',
  theme_id  text references public.themes(id) default 'classic',
  piece_set text references public.piece_sets(id) default 'standard'
);
