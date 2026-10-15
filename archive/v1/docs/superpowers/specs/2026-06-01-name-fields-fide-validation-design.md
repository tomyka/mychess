# Name Fields + FIDE Validation — Design

**Date:** 2026-06-01  
**Scope:** Kid settings page — add First Name / Last Name fields; validate against fide.com when FIDE ID is set.

---

## Problem

The settings page has no name fields. FIDE ID can be entered but is never cross-checked against the player's real name on fide.com, making it trivial to link the wrong FIDE profile.

---

## Solution

Add `first_name` and `last_name` to `profiles`. When a FIDE ID is saved, scrape `ratings.fide.com/profile/{fide_id}` and confirm the entered name matches. Block save on mismatch.

---

## Database

New migration `0012_name_fields.sql`:

```sql
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;
```

---

## FIDE Scrape Helper

File: `mychess/src/lib/server/fide.ts`

```ts
export async function fetchFideName(fideId: string): Promise<{ firstName: string; lastName: string } | null>
```

- Fetches `https://ratings.fide.com/profile/{fideId}`
- Extracts name from `<h1 class="player-title">Surname, Firstname</h1>` via regex
- Returns `{ firstName, lastName }` or `null` if not found / network error
- FIDE format is always "Surname, Firstname" — split on `, `

---

## Settings Page — UI

File: `mychess/src/routes/(kid)/settings/+page.svelte`

Add two inputs in the "Connected accounts" section, **above** the FIDE ID field:

- **First Name** (`first_name`) — text input, optional unless FIDE ID is set
- **Last Name** (`last_name`) — text input, optional unless FIDE ID is set

Helper text under FIDE ID: "Your FIDE ID number (find it at ratings.fide.com). First and Last name must match your FIDE profile."

---

## Settings Page — Server Action

File: `mychess/src/routes/(kid)/settings/+page.server.ts`

### `save` action logic:

1. Parse `first_name`, `last_name`, `fide_id`, `chesscom_username`, `lichess_username` from form data.
2. If `fide_id` is non-empty:
   - If `first_name` or `last_name` is empty → `fail(400, { error: 'First and last name are required when a FIDE ID is set.' })`
   - Call `fetchFideName(fide_id)`
   - If returns `null` → `fail(400, { error: 'Could not look up FIDE profile. Check your FIDE ID.' })`
   - Compare entered names case-insensitively to FIDE names. If mismatch → `fail(400, { error: 'Name does not match FIDE profile. Expected: {firstName} {lastName}.' })`
3. Update `profiles` with `first_name`, `last_name`, `fide_id`, `chesscom_username`, `lichess_username`.

### Load function:

Add `first_name` and `last_name` to the `select(...)` query and return them.

---

## Error Cases

| Situation | Behaviour |
|-----------|-----------|
| FIDE ID set, names empty | Block — "First and last name required when FIDE ID is set" |
| FIDE ID set, FIDE page unreachable | Block — "Could not look up FIDE profile. Check your FIDE ID." |
| FIDE ID set, name mismatch | Block — "Name does not match FIDE profile. Expected: {firstName} {lastName}." |
| FIDE ID not set | Save names as entered, no validation |

---

## Out of Scope

- Coach settings page (coaches don't have FIDE IDs in current flows)
- Caching FIDE responses
- Periodic re-validation after initial save
