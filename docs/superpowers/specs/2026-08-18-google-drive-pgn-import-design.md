# Google Drive PGN Import — Design Spec

**Date:** 2026-08-18
**Status:** Approved for planning
**Scope:** Add a "…or import from Google Drive" option to the existing repertoire PGN upload form.

## Problem

`PgnImportForm.svelte` currently accepts a PGN two ways: pasted text, or a local `.pgn` file read
client-side via `FileReader`. A user whose repertoire files live in Google Drive has to download the
file locally first before they can upload it. This adds a third source — pick a file directly from
Google Drive — that feeds the exact same pipeline.

## Goals

- Let a user pick a `.pgn`-ish file from their Google Drive and have its contents populate the
  existing PGN import flow, with zero changes to parsing, submission, or error surfaces downstream.
- No new backend infrastructure: no new routes, no new DB schema, no server-side token storage.
- Request Drive access only at the moment of use, scoped as narrowly as Google allows for a picker
  integration — never a standing "connected account."

## Non-goals

- No persistent "connected Google account" (unlike Lichess/Chess.com in Settings). Access is
  requested fresh each time the button is clicked; nothing is stored server-side. Google's own
  session/consent caching means this usually isn't a full re-auth every time, but this app makes no
  promise about that and stores nothing to guarantee it.
- No change to the existing Google Sign-In flow (`src/routes/auth/google/*`) — this is a fully
  separate, client-side-only OAuth interaction using a different, narrower scope.
- No broader Drive access (browsing folders for other purposes, syncing, etc.) — picking one file for
  one import, same as the local-file path it sits beside.
- No support for Google Docs-native files (a PGN pasted into a Google Doc rather than uploaded as a
  file) — only real Drive files whose raw bytes can be fetched via `alt=media`.

## Architecture

Purely client-side. Two new pieces:

1. **`src/lib/googleDrivePicker.ts`** — a thin wrapper around Google's two JS SDKs (Identity Services
   for the OAuth token, Picker API for the file browser), exporting:

   ```ts
   export async function pickPgnFromGoogleDrive(): Promise<{ name: string; text: string } | null>
   ```

   Returns `null` on any user cancellation (closed consent popup, closed picker without selecting).
   Resolves with the picked file's name and raw text content on success. Throws a plain `Error` with
   a user-facing message on a real failure (SDK script failed to load, Drive fetch failed).

2. **`PgnImportForm.svelte`** gains a new button, "…or import from Google Drive", visually matching
   the existing "Choose File" button (same `cursor-pointer`/`bg-gray-100`/border styling, just a
   `<button>` instead of a file-input `<label>` since there's no native file input here). On click,
   calls `pickPgnFromGoogleDrive()`; on a non-null result, sets `pgnText`, `name` (stripped of
   extension, same as the local-file path), and `fileName` — reusing every bit of state the local-file
   path already populates, so the rest of the form (parse, submit, per-chapter progress, errors)
   needs no changes at all. A `driveError` state (styled like the existing `fileError`) surfaces
   thrown errors; a `null` result is a silent no-op.

### `pickPgnFromGoogleDrive()` internals

```
1. Lazily inject <script src="https://accounts.google.com/gsi/client"> and
   <script src="https://apis.google.com/js/api.js"> if not already present
   (idempotent — checks window.google/window.gapi first).
2. gapi.load('picker', ...) to load the Picker library.
3. google.accounts.oauth2.initTokenClient({
     client_id: PUBLIC_GOOGLE_CLIENT_ID,
     scope: 'https://www.googleapis.com/auth/drive.file',
     callback: (tokenResponse) => { ... }
   }).requestAccessToken() — triggers Google's consent UI if not already granted
   this browser session for this scope.
4. On token received, build and show a Picker:
   new google.picker.PickerBuilder()
     .addView(google.picker.ViewId.DOCS)   // generic "all files" view — PGN
                                            // files have no distinctive Drive
                                            // mimetype to filter on
     .setOAuthToken(token)
     .setDeveloperKey(PUBLIC_GOOGLE_API_KEY)
     .setCallback(pickerCallback)
     .build()
     .setVisible(true);
5. pickerCallback: on ACTION_PICKED, take the first selected doc's id + name.
   On ACTION_CANCEL, resolve the outer promise with null.
6. Fetch content: fetch(
     `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
     { headers: { Authorization: `Bearer ${token}` } }
   ) → res.text().
7. Resolve { name, text }.
```

Steps 3-4 both have their own cancel path (closing the Google consent popup vs. closing the picker
itself without picking) — both resolve the outer promise with `null`, not an error.

## Configuration (external setup, not implementable by an agent)

Two new public env vars, read via `$env/dynamic/public` (matching this app's existing pattern for
`PUBLIC_SUPABASE_URL`):

- `PUBLIC_GOOGLE_CLIENT_ID` — same value as the existing private `GOOGLE_CLIENT_ID`
  (`src/routes/auth/google/+server.ts`), additionally exposed publicly. Safe to expose: this client
  already has no client secret (the sign-in flow is PKCE-only), and Google's own client-side token
  flows are designed to run with a public client ID.
- `PUBLIC_GOOGLE_API_KEY` — a new Picker-specific API key, created in the same GCP project, restricted
  by HTTP referrer to this app's domains.

Before this feature can be manually verified end-to-end, the user needs to, in Google Cloud Console:
1. Enable the **Google Drive API** and **Google Picker API** on the project backing the existing
   OAuth client.
2. Confirm the existing OAuth Client ID's "Authorized JavaScript origins" include the app's dev and
   production origins (likely already true for sign-in, but the Picker's token-client flow re-checks
   this).
3. Create a Picker API key, HTTP-referrer-restricted.
4. Add both env vars above to Vercel (and local `.env` for dev testing).

This is a manual, one-time setup step outside this codebase — analogous to how a previous feature's
Supabase migration needed the user to apply it manually. The code can be written and its non-Google
parts tested without these credentials; only live end-to-end verification needs them.

## Error handling

- SDK script fails to load (network blocked, ad blocker) → `pickPgnFromGoogleDrive()` throws; caught
  in `PgnImportForm.svelte`, shown via a new `driveError` state styled identically to the existing
  `fileError` text.
- User closes the consent popup or the picker without selecting → resolves `null`, no error shown.
- Drive fetch fails (rare — token just issued, short-lived) → throws, same error surface as above.
- Picked file isn't valid PGN → no new validation added here; the existing `planMultiImport` check at
  submit time already produces a clear "not valid PGN"-style error, exactly as it does today for a
  bad paste or a bad local file. Duplicating that check here would just be two places that can drift.

## Testing

`googleDrivePicker.ts` is a thin wrapper around two external SDKs and browser globals (`window.google`,
`window.gapi`, `fetch`) — not unit-tested directly, matching this codebase's established convention
for similar thin I/O wrappers (e.g. `src/lib/fide/download.ts`). `PgnImportForm.test.ts` gains new
cases that mock the module's exported `pickPgnFromGoogleDrive` function (via `vi.mock`) to verify:
the button calls it on click, a successful result populates `pgnText`/`name`/`fileName` correctly, a
`null` result is a silent no-op, and a thrown error surfaces via the new `driveError` state.

## Rollout note

Since the Google Cloud configuration above is a manual prerequisite, the code can be merged and
deployed before it's configured — the button will simply fail with the "couldn't load Google Drive"
error state until the env vars are set, which is a safe, contained failure mode (doesn't affect the
paste or local-file paths at all).
