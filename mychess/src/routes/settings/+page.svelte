<script lang="ts">
  import { enhance } from '$app/forms';
  import PlatformRatingsCard from '$lib/components/PlatformRatingsCard.svelte';
  import { setTheme, themeStore } from '$lib/theme.svelte';
  import type { Theme } from '$lib/theme';
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import {
    BOARD_THEMES,
    PIECE_SETS,
    ANIMATION_SPEEDS,
    DEFAULT_PREFS,
    type BoardPrefs
  } from '$lib/board/prefs';

  let { data, form } = $props<{ data: any; form: any }>();

  const d = $derived(data as any);
  let role = $state<'player' | 'coach'>((data as any)?.role ?? 'player');
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);

  let boardPrefs = $state<BoardPrefs>({ ...((data as any).boardPrefs ?? DEFAULT_PREFS) });

  // A sample position after 1.e4 with a last move so the highlight toggle is visible.
  const PREVIEW_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  const PREVIEW_LAST_MOVE = ['e2', 'e4'] as ['e2', 'e4'];

  const boardEnhance = () => async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };

  // Apply the action result and refresh data, but DON'T reset the form —
  // the default enhance calls form.reset(), which clears the typed
  // first/last name inputs (they reappear only on a fresh page load).
  const saveEnhance = () => async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };

  async function importGames(platform: 'chesscom' | 'lichess') {
    importing = platform;
    importResult = null;
    try {
      const res = await fetch(`/api/import/${platform}`, { method: 'POST' });
      const body = await res.json();
      if (body.count !== undefined) {
        importResult = `Imported ${body.count} game(s) as a new repertoire.`;
      } else {
        importResult = body.error ?? 'Import failed';
      }
    } catch {
      importResult = 'Network error';
    } finally {
      importing = null;
    }
  }
</script>

<svelte:head>
  <title>Settings — MyChess</title>
</svelte:head>

<div class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <h1 class="text-2xl font-bold text-(--color-text)">Settings</h1>

    {#if form?.success}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm dark:bg-green-950 dark:border-green-800 dark:text-green-400">
        Saved successfully.
      </p>
    {/if}
    {#if form?.error}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400">
        {form.error}
      </p>
    {/if}
    {#if d.oauthSuccess}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm dark:bg-green-950 dark:border-green-800 dark:text-green-400">
        {d.oauthSuccess}
      </p>
    {/if}
    {#if d.oauthError}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400">
        {d.oauthError}
      </p>
    {/if}

    <section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-4">Appearance</h2>
      <div class="flex gap-3">
        {#each [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }] as const as t (t.id)}
          <button
            type="button"
            onclick={() => setTheme(t.id as Theme)}
            class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                   {themeStore.current === t.id ? 'border-(--color-accent) bg-indigo-50 dark:bg-indigo-950 text-indigo-700' : 'border-(--color-border) text-(--color-muted) hover:border-gray-300 dark:hover:border-gray-600'}"
          >
            {t.label}
          </button>
        {/each}
      </div>
    </section>

    <section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-4">Profile</h2>
      <form method="POST" action="?/save" use:enhance={saveEnhance} class="space-y-4">

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-(--color-text) mb-1" for="first_name">First Name</label>
            <input
              id="first_name"
              name="first_name"
              type="text"
              value={d.firstName}
              placeholder="e.g. Magnus"
              class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-(--color-text) mb-1" for="last_name">Last Name</label>
            <input
              id="last_name"
              name="last_name"
              type="text"
              value={d.lastName}
              placeholder="e.g. Carlsen"
              class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <span class="block text-sm font-medium text-(--color-text) mb-1">I am a</span>
          <div class="flex gap-3">
            {#each [{ id: 'player', label: 'Player' }, { id: 'coach', label: 'Coach' }] as const as r (r.id)}
              <button
                type="button"
                onclick={() => (role = r.id)}
                class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                       {role === r.id ? 'border-(--color-accent) bg-indigo-50 dark:bg-indigo-950 text-indigo-700' : 'border-(--color-border) text-(--color-muted) hover:border-gray-300 dark:hover:border-gray-600'}"
              >
                {r.label}
              </button>
            {/each}
          </div>
          <input type="hidden" name="role" value={role} />
        </div>

        <div>
          <label class="block text-sm font-medium text-(--color-text) mb-1" for="fide_id">FIDE ID</label>
          <input
            id="fide_id"
            name="fide_id"
            type="text"
            value={d.fideId}
            placeholder="e.g. 1503014"
            class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-(--color-muted) mt-1">
            Your FIDE ID number (find it at ratings.fide.com). First and last name must match your FIDE profile.
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-(--color-text) mb-1" for="chesscom_username">Chess.com Username</label>
          <input
            id="chesscom_username"
            name="chesscom_username"
            type="text"
            value={d.chesscomUsername}
            placeholder="e.g. MagnusCarlsen"
            class="w-full bg-(--color-surface) border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-(--color-muted) mt-1">
            Your Chess.com username. We'll verify it exists. Leave blank to disconnect.
          </p>
        </div>

        <button
          type="submit"
          class="bg-(--color-accent) text-white px-5 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          Save
        </button>
      </form>
    </section>

    <section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-4">Board</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
        <div class="max-w-[260px] w-full">
          <ChessBoard
            fen={PREVIEW_FEN}
            interactable={false}
            lastMove={PREVIEW_LAST_MOVE}
            prefs={boardPrefs}
          />
        </div>

        <form method="POST" action="?/save_board_prefs" use:enhance={boardEnhance} class="space-y-4">
          <div>
            <span class="block text-xs uppercase tracking-wide text-(--color-muted) mb-2">Theme</span>
            <div class="flex flex-wrap gap-2">
              {#each BOARD_THEMES as t (t.id)}
                <button
                  type="button"
                  onclick={() => (boardPrefs.theme = t.id)}
                  class="w-10 h-10 rounded-md border-2 {boardPrefs.theme === t.id ? 'border-blue-500' : 'border-transparent'}"
                  style="background: linear-gradient(135deg, {t.light} 0 50%, {t.dark} 50% 100%);"
                  aria-label={t.label}
                  title={t.label}
                ></button>
              {/each}
            </div>
            <input type="hidden" name="theme" value={boardPrefs.theme} />
          </div>

          <div>
            <span class="block text-xs uppercase tracking-wide text-(--color-muted) mb-2">Piece set</span>
            <div class="flex flex-wrap gap-2">
              {#each PIECE_SETS as p (p.id)}
                <button
                  type="button"
                  onclick={() => (boardPrefs.pieceSet = p.id)}
                  class="px-3 py-1.5 rounded-md text-sm border {boardPrefs.pieceSet === p.id ? 'bg-blue-500 text-white border-blue-500' : 'border-(--color-border) text-(--color-text)'}"
                >{p.label}</button>
              {/each}
            </div>
            <input type="hidden" name="pieceSet" value={boardPrefs.pieceSet} />
          </div>

          <div>
            <span class="block text-xs uppercase tracking-wide text-(--color-muted) mb-2">Animation</span>
            <div class="flex flex-wrap gap-2">
              {#each ANIMATION_SPEEDS as a (a.id)}
                <button
                  type="button"
                  onclick={() => (boardPrefs.animation = a.id)}
                  class="px-3 py-1.5 rounded-md text-sm border {boardPrefs.animation === a.id ? 'bg-blue-500 text-white border-blue-500' : 'border-(--color-border) text-(--color-text)'}"
                >{a.label}</button>
              {/each}
            </div>
            <input type="hidden" name="animation" value={boardPrefs.animation} />
          </div>

          <label class="flex items-center gap-2 text-sm text-(--color-text)">
            <input type="checkbox" bind:checked={boardPrefs.coordinates} />
            Show coordinates
          </label>
          <input type="hidden" name="coordinates" value={boardPrefs.coordinates} />

          <label class="flex items-center gap-2 text-sm text-(--color-text)">
            <input type="checkbox" bind:checked={boardPrefs.highlight} />
            Highlight last move
          </label>
          <input type="hidden" name="highlight" value={boardPrefs.highlight} />

          <div class="flex gap-2 pt-1">
            <button type="submit" class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium">Save</button>
            <button
              type="button"
              onclick={() => (boardPrefs = { ...DEFAULT_PREFS })}
              class="px-4 py-2 rounded-md border border-(--color-border) text-(--color-text) text-sm"
            >Reset to default</button>
          </div>
        </form>
      </div>
    </section>

    <section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-4">Connected accounts</h2>
      <div class="space-y-4">

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-(--color-text)">Lichess</p>
            {#if d.lichessUsername}
              <p class="text-sm text-(--color-muted)">Connected as <span class="font-mono">{d.lichessUsername}</span></p>
            {:else}
              <p class="text-sm text-(--color-muted)">Not connected</p>
            {/if}
          </div>
          {#if d.lichessUsername}
            <form method="POST" action="?/disconnect_lichess" use:enhance>
              <button
                type="submit"
                class="text-sm border border-(--color-border) text-(--color-text) px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Disconnect
              </button>
            </form>
          {:else}
            <a
              href="/auth/connect/lichess"
              class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
              Connect
            </a>
          {/if}
        </div>

        <PlatformRatingsCard platform="Lichess" username={d.lichessUsername || null} ratings={d.lichessRatings ?? null} />

      </div>
    </section>

    <section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-4">Import games</h2>
      <p class="text-sm text-(--color-muted) mb-4">
        Import your recent games as a new repertoire. Connect your platform accounts above first.
      </p>

      {#if importResult}
        <p class="text-sm text-(--color-text) bg-(--color-bg) border border-(--color-border) rounded-lg px-4 py-2 mb-4">
          {importResult}
        </p>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={() => importGames('chesscom')}
          disabled={importing !== null || !d.chesscomUsername}
          class="flex-1 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm">
          {importing === 'chesscom' ? 'Importing…' : 'Import from Chess.com'}
        </button>
        <button
          onclick={() => importGames('lichess')}
          disabled={importing !== null || !d.lichessUsername}
          class="flex-1 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm">
          {importing === 'lichess' ? 'Importing…' : 'Import from Lichess'}
        </button>
      </div>
    </section>
  </div>
</div>
