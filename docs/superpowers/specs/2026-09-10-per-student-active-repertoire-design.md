# Per-student active repertoire mapping

GitHub issue #202 — part B of epic #119, which was split into three
(#201/#202/#203) because taxonomy, mapping semantics and prep UI each ship
independently and verify differently. Part A (#201) shipped the curated
taxonomy and `resolveOpening`; part C (#203) builds the prep and coverage-gap
views on top of what this defines.

## Problem

When a coach has several repertoires for the same opening built over time,
nothing records which one is current for which student. A coach may legitimately
hold one student on last season's file while another has moved to the rewrite,
and today that fact lives only in the coach's head.

## What already exists, and shapes the design

- **`resolveOpening`** (`src/lib/openings/resolve.ts`) answers "which curated
  opening does this repertoire prepare". It **derives** the answer from
  `(eco_code, color)`; `repertoires.opening_id` holds only a coach's explicit
  override and is null on almost every row, by design.
- **The consequence for this issue, recorded on #202 before it was started:**
  *do not key off `repertoires.opening_id` in SQL.* A join or filter on that
  column silently misses every derived row — the majority. Any question of the
  form "which opening is this repertoire for" must go through `resolveOpening`
  in application code.
- **`assigned_repertoires`** (0005) is `unique(player_id, repertoire_id)` and
  carries the coach↔student↔repertoire assignment. Its RLS was hardened in 0030
  (the assigned repertoire must belong to the assigning coach) and 0040 (that
  ownership check must run through a `security definer` function, or the policy
  cycle `assigned_repertoires → repertoires → assigned_repertoires` makes
  Postgres refuse the query outright).
- **A player can own repertoires nobody assigned to them** — `/(player)/repertoires`
  lists self-uploaded files alongside assigned ones.

## Decisions

| Question | Decision |
| --- | --- |
| Does part B ship UI? | Schema, RLS and server actions, plus a minimal "make active" control on the coach's student page. Part C keeps the student prep view and the gap report. |
| First assignment for an opening | Auto-activates. Later assignments for the same opening do not displace it. |
| Active repertoire gets unassigned | The opening goes back to no-active. Nothing is promoted in its place. |
| Self-uploaded repertoires | In scope — a repertoire may be active if the student owns it *or* it is assigned to them. |
| Who may change it | An active coach of the student, or the student themselves. |

## Design

### One table, holding only the active choice

`supabase/migrations/0079_active_opening_repertoires.sql`:

```sql
create table public.active_opening_repertoires (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  opening_id    text not null,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  set_by        uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (player_id, opening_id)
);
```

**Row existence is what "active" means**, so `primary key (player_id, opening_id)`
*is* the acceptance criterion — exactly one active repertoire per (student,
opening), enforced by Postgres with no application code in the loop. The
alternative shapes were weighed and rejected:

- **Columns on `assigned_repertoires`** (`opening_id` + `is_active`, with a
  partial unique index) is what #202's body proposes and is the cheapest
  migration. It cannot represent a self-uploaded repertoire as active, because
  no assignment row exists for one, so the scope decision above rules it out.
  It would also put two columns meaning nothing to assignment onto a table read
  on most pages.
- **Storing every candidate mapping with an `active` flag** matches the issue's
  literal wording, but each non-active row would duplicate a repertoire→opening
  fact `resolveOpening` already answers — the exact copy part A declined to
  make. Candidates are derivable: every repertoire the student can see whose
  resolved opening matches. Only the *choice* is not derivable, and only the
  choice is stored.

**No foreign key on `opening_id`.** The taxonomy is a TypeScript module, not a
table, for 0078's reasons; integrity is `taxonomy.test.ts` plus the staleness
rule below. **No unique on `(player_id, repertoire_id)`** either — a repertoire
resolves to exactly one opening, so it cannot be active for two.

**`set_by` is written and not yet read.** Ordinarily that fails YAGNI. It is
included because two writers exist by design, "was this the coach holding me
back, or me?" is the first question part C's coach view asks, and every
migration on this project is a hand-pasted dashboard step — the column is
nearly free now and costs a whole round trip later.

### Availability is one function, shared by RLS and the server

```sql
create or replace function public.repertoire_available_to(p_repertoire_id uuid, p_player_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.repertoires r
    where r.id = p_repertoire_id and r.player_id = p_player_id
  ) or exists (
    select 1 from public.assigned_repertoires a
    where a.repertoire_id = p_repertoire_id and a.player_id = p_player_id
  );
$$;
```

"The student owns it, or it is assigned to them" is the rule for *may this be
the active one*. Both the RLS write policies and the server-side validation call
this same function, so the two cannot drift apart.

`security definer` is not decoration: migration 0040 established that a plain
correlated subquery against `repertoires` from inside a policy re-enters
`repertoires`' own RLS, which queries `assigned_repertoires` back, and Postgres
refuses to expand the cycle rather than resolving it. A `security definer`
function is never inlined, so the cycle never forms.

### RLS

- **Read** — the student (`player_id = auth.uid()`), or a coach with an `active`
  `coach_players` row for them.
- **Write** — three separate `insert` / `update` / `delete` policies rather than
  one `for all`, because Postgres ORs permissive policies for the same operation
  together and a broad one silently defeats a narrow one. Each allows the
  student for their own row, or an active coach of that student, and in both
  cases requires `repertoire_available_to(repertoire_id, player_id)`.
- A coach may activate anything the student can already see, including the
  student's own upload. That is a choice among material they already have, not a
  grant of access.
- `revoke all on public.active_opening_repertoires from anon, public`, then grant
  to `authenticated` — Supabase's default `anon` grant is not removed by granting
  to `authenticated`.

### Unassigning clears the mapping, at the database layer

```sql
create function public.clear_active_opening_on_unassign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.active_opening_repertoires
   where player_id = old.player_id and repertoire_id = old.repertoire_id;
  return old;
end $$;

create trigger clear_active_opening_on_unassign
  after delete on public.assigned_repertoires
  for each row execute function public.clear_active_opening_on_unassign();
```

A trigger rather than a line in the unassign action, so the mapping cannot
survive its repertoire under any write path, including a raw one. It needs no
"unless the student owns it anyway" guard: 0030 requires an assigned repertoire
to belong to the assigning coach, so an assigned repertoire is never the
student's own. Deleting the repertoire itself is already handled by the FK
cascade.

### Staleness: a stored choice can stop matching its repertoire

The taxonomy is edited by hand and will churn. A row written when repertoire R
resolved to `sicilian-alapin-white` keeps pointing at that opening after an edit
moves R elsewhere.

`src/lib/openings/active.ts` (pure, with `active.test.ts`):

- `isActiveRowStale(row, repertoire)` — true when
  `resolveOpening(repertoire)?.id !== row.opening_id`.
- `activeByOpening(repertoires, rows)` — the `Map<openingId, repertoire>` part C
  reads, with stale rows dropped.

**A stale row is ignored at read time, not deleted.** This mirrors part A's rule
for an override naming a since-deleted entry: showing the wrong opening's
preparation is worse than showing none. Ignoring rather than deleting also means
a taxonomy edit that is reverted simply works again, instead of having destroyed
data on the way through.

### Writing the mapping

`src/lib/server/active-openings.ts` — I/O, following the `lib/` pure vs
`lib/server/` I/O split:

- `setActive(supabase, { playerId, repertoireId, setBy })` — resolves the
  opening **in application code**, fails cleanly when the repertoire resolves to
  no curated opening, then upserts with an explicit
  `{ onConflict: 'player_id,opening_id' }` (a bare `.upsert()` would target the
  PK — here that happens to be the same columns, but stating it keeps the call
  correct if the key ever changes).
- `activateIfUnset(…)` — the same insert with `ignoreDuplicates: true`, so
  "does not displace an existing choice" is a database no-op rather than a
  read-then-write race between two coaches.
- `loadActive(supabase, playerId)` — rows plus their repertoires, staleness
  filtered through `activeByOpening`.

**Auto-activation fires in two places**, both calling `activateIfUnset`: the
coach's `assignRep` action, and the PGN import path for the uploader's own new
repertoire. The rule is uniform — *the first repertoire you can see for an
opening becomes your active one, and nothing later displaces it* — so there is
no role branch, and a coach's own uploads get mappings too, which gives coaches
a working prep view in part C for free.

A re-upload (`apply_repertoire_update`, 0074) keeps the repertoire's id, so the
mapping survives it untouched. A deleted repertoire cascades its mapping away.

### The coach's control

On `/coach/players/[player_id]`, each repertoire in the existing assigned list
gains its resolved opening name and either an "Active" marker or a "Make active"
button, posting a new `setActive` action. A repertoire resolving to no curated
opening shows neither — never a button whose action would fail.

The page is **not** regrouped by opening. Part C designs the opening-oriented
view; this is the smallest control that makes #202's own acceptance criterion
checkable by a human. New strings go through Paraglide in both `en` and `lt`.

The list shows assigned repertoires only, so an opening whose active repertoire
is one the student uploaded themselves shows no "Active" marker anywhere on this
page — the coach's own material for that opening all offers "Make active", and
pressing one takes the opening over. That is honest but incomplete, and it is
part of why the opening-oriented view is part C's job rather than this one's.

### Backfill

`scripts/backfill-active-openings.ts`, run once with the service-role key:
applies `activateIfUnset` over every existing assignment and every self-owned
repertoire, so the auto-activation rule holds retroactively. Order is
`assigned_repertoires.assigned_at` for assignments and `repertoires.created_at`
for self-owned ones, both ascending, so the oldest wins an opening and the
result does not depend on the order rows come back in.
Without it, part C's "no active preparation for this opening" would mean "nobody
has tagged this yet" for every pre-existing student, which is the wrong answer
to the question that view exists to ask.

## Acceptance Criteria

- A coach can map several repertoires to one opening for a student and mark
  exactly one active.
- Exactly one active mapping per (student, opening), enforced by the table's
  primary key rather than by application logic.
- Changing the active repertoire touches no progress state on either repertoire.
- A student with no active mapping for an opening is representable — the row is
  simply absent, which is what part C surfaces.
- A self-uploaded repertoire can be the active one for its owner.
- Unassigning the active repertoire leaves that opening with no active mapping.

## Non-Goals

- The prep view and the coverage-gap view — part C (#203).
- Any progress state on openings or mappings. Learning progress stays with
  repertoires.
- A student-facing control for changing the active repertoire. The RLS permits
  it; the UI for it belongs with part C's prep view.
- Changing how `assigned_repertoires` itself works.
- Cleaning up stale rows after a taxonomy edit. They are ignored, not collected.

## Verification

Unit tests cover the pure layer: staleness, `activeByOpening`, and a repertoire
that resolves to no opening.

The primary key, the RLS arms and the unassign trigger cannot be tested here —
there is no local Postgres and no linked Supabase CLI, so migration 0079 is a
hand-pasted dashboard step. They are checked against production after it is
applied.

Because that manual step exists, the PR carries **no** `Closes #202`. The issue
stays open until the migration is confirmed applied, exactly as #201 did and for
the reason #105 established.
