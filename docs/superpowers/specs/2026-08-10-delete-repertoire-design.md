# Delete Repertoire — Design

## Purpose

Players can create repertoires (`/repertoires/new`, PGN import) but have no way to remove one afterward — the only existing delete action lives on the coach's repertoire page (`src/routes/(coach)/coach/repertoires/+page.server.ts`). This adds a delete action to the player's own repertoire list (`src/routes/(player)/repertoires/+page.svelte`), scoped to repertoires the player owns (`repertoires.player_id = auth.uid()`), following the same hard-delete pattern already used on the coach page.

## Scope decision (confirmed)

- Player-owned repertoires only — the "My Repertoires" list. The separate "Assigned by your coach" list on the same page (sourced from `assigned_repertoires`, someone else's repertoire) is untouched; players can't delete a repertoire they don't own.
- Coach-side UX (assigning, unassigning, the coach's own delete action) is out of scope — it already exists and isn't changing.
- Hard delete, no soft-delete/undo — matches every other delete in this codebase (coach repertoire delete, `coach_players` unassign). No new pattern introduced.

## The blocker: FK constraints don't cascade cleanly today

`repertoires.id` is referenced by `moves`, `assigned_repertoires`, `variation_progress`, and `level_progress`, all with `on delete cascade` — those clean up fine. But two more tables sit downstream with no cascade rule (default `NO ACTION`/RESTRICT):

- `sessions.repertoire_id` (`0001_core_tables.sql:75`) — nullable FK, no `on delete` clause.
- `review_events.move_id` (`0001_core_tables.sql:86`) — `not null` FK, no `on delete` clause. Since `moves` cascades from `repertoires`, deleting a repertoire tries to delete its `moves` rows too, which is blocked by any `review_events` still pointing at them.

In practice, any repertoire that's ever been practiced (drilled via `learn`/`practice` sessions) already has `sessions` and `review_events` rows, so today a delete on such a repertoire would fail with a foreign-key violation. This has to be fixed before the delete action ships, not worked around in application code.

**Resolution (confirmed):** cascade-delete everything. Migration `0033_repertoire_delete_cascade.sql` drops and recreates both FKs with `on delete cascade`:

```sql
alter table public.sessions
  drop constraint sessions_repertoire_id_fkey,
  add constraint sessions_repertoire_id_fkey
    foreign key (repertoire_id) references public.repertoires(id) on delete cascade;

alter table public.review_events
  drop constraint review_events_move_id_fkey,
  add constraint review_events_move_id_fkey
    foreign key (move_id) references public.moves(id) on delete cascade;
```

(Exact constraint names to be confirmed against the live schema before running — per project convention, migrations aren't applied by Claude; the user runs this in the Supabase SQL editor.)

Deleting a repertoire this way also deletes the player's `sessions`/`review_events` history for it. `player_stats` (aggregate totals: `total_reviews`, `total_correct`, `moves_learned`) is a separate table with no FK to `repertoires` or `sessions` — it is not recalculated or rolled back, so a player's overall stats/level are unaffected by deleting a repertoire.

## Server action

Add a `delete` action to `src/routes/(player)/repertoires/+page.server.ts`, mirroring the coach page's existing action (`src/routes/(coach)/coach/repertoires/+page.server.ts:41-52`) exactly:

```ts
delete: async ({ request, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const fd = await request.formData();
	const repId = fd.get('rep_id') as string;
	if (!repId) return fail(400, { error: 'No repertoire selected' });

	const { error } = await supabase.from('repertoires').delete().eq('id', repId).eq('player_id', user!.id);
	if (error) return fail(500, { error: error.message });

	return { success: true };
}
```

The `.eq('player_id', user!.id)` ownership check plus the existing `repertoires_player_all` RLS policy (`0002_rls.sql:27`, `for all using (player_id = auth.uid())`) are sufficient authorization — no new RLS policy needed. No pre-check of assignment/practice state is needed before issuing the delete; the cascade migration above makes it unconditionally safe.

## UI

In `src/routes/(player)/repertoires/+page.svelte`, add a delete button to each `<li>` in the "My Repertoires" list only (not the assigned-repertoires section), following the coach page's form pattern (`src/routes/(coach)/coach/repertoires/+page.svelte:99-102`):

```svelte
<form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
	<input type="hidden" name="rep_id" value={rep.id} />
	<button class="text-sm text-red-600 hover:underline">Delete</button>
</form>
```

```ts
function confirmDelete(e: SubmitEvent, name: string) {
	if (!confirm(`Delete "${name}"? This can't be undone and will also delete all practice history for it.`)) {
		e.preventDefault();
	}
}
```

Wording differs from the coach page's confirm text (which warns about removing student assignments — not applicable here, since a player-owned repertoire being deleted isn't assigned to anyone via `assigned_repertoires` in this flow). Surface `form?.error` the same way the coach page does, if the delete action fails.

## What doesn't change

- No soft-delete, no confirmation modal component (browser `confirm()` matches the one existing precedent).
- No changes to the coach page, `assigned_repertoires` flows, or `player_stats` calculation.
- No changes to `moves`, `positions`, `variation_progress`, `level_progress`, `reviews` cascade behavior — those already cascade correctly.

## Out of scope

- Deleting/unassigning a repertoire from the coach's or a student's perspective (already exists).
- Any soft-delete, trash/restore, or export-before-delete flow.
- Bulk delete.
