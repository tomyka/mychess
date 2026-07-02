<script lang="ts">
  import { enhance } from '$app/forms';
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';

  let { data, form } = $props<{ data: any; form: any }>();

  const d = $derived(data as any);
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);

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

<div class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <h1 class="text-2xl font-bold text-gray-900">Settings</h1>

    {#if form?.success}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
        Saved successfully.
      </p>
    {/if}
    {#if form?.error}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">
        {form.error}
      </p>
    {/if}
    {#if d.oauthSuccess}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
        {d.oauthSuccess}
      </p>
    {/if}
    {#if d.oauthError}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">
        {d.oauthError}
      </p>
    {/if}

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Profile</h2>
      <form method="POST" action="?/save" use:enhance class="space-y-4">

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="first_name">First Name</label>
            <input
              id="first_name"
              name="first_name"
              type="text"
              value={d.firstName}
              placeholder="e.g. Magnus"
              class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1" for="last_name">Last Name</label>
            <input
              id="last_name"
              name="last_name"
              type="text"
              value={d.lastName}
              placeholder="e.g. Carlsen"
              class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="fide_id">FIDE ID</label>
          <input
            id="fide_id"
            name="fide_id"
            type="text"
            value={d.fideId}
            placeholder="e.g. 1503014"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-gray-400 mt-1">
            Your FIDE ID number (find it at ratings.fide.com). First and last name must match your FIDE profile.
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="rank_basis">Rank based on</label>
          <select
            id="rank_basis"
            name="rank_basis"
            value={d.rankBasis}
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="standard">Standard</option>
            <option value="rapid">Rapid</option>
            <option value="blitz">Blitz</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            Which FIDE rating your country and age-group rank are based on.
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="chesscom_username">Chess.com Username</label>
          <input
            id="chesscom_username"
            name="chesscom_username"
            type="text"
            value={d.chesscomUsername}
            placeholder="e.g. MagnusCarlsen"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-gray-400 mt-1">
            Your Chess.com username. We'll verify it exists. Leave blank to disconnect.
          </p>
        </div>

        <button
          type="submit"
          class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Save
        </button>
      </form>
    </section>

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Connected accounts</h2>
      <div class="space-y-4">

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-700">Lichess</p>
            {#if d.lichessUsername}
              <p class="text-sm text-gray-500">Connected as <span class="font-mono">{d.lichessUsername}</span></p>
            {:else}
              <p class="text-sm text-gray-400">Not connected</p>
            {/if}
          </div>
          {#if d.lichessUsername}
            <form method="POST" action="?/disconnect_lichess" use:enhance>
              <button
                type="submit"
                class="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                Disconnect
              </button>
            </form>
          {:else}
            <a
              href="/auth/connect/lichess"
              class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
              Connect
            </a>
          {/if}
        </div>

        <LichessStatsCard username={d.lichessUsername || null} ratings={d.lichessRatings ?? null} />

      </div>
    </section>

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Import games</h2>
      <p class="text-sm text-gray-500 mb-4">
        Import your recent games as a new repertoire. Connect your platform accounts above first.
      </p>

      {#if importResult}
        <p class="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4">
          {importResult}
        </p>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={() => importGames('chesscom')}
          disabled={importing !== null || !d.chesscomUsername}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'chesscom' ? 'Importing…' : 'Import from Chess.com'}
        </button>
        <button
          onclick={() => importGames('lichess')}
          disabled={importing !== null || !d.lichessUsername}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'lichess' ? 'Importing…' : 'Import from Lichess'}
        </button>
      </div>
    </section>
  </div>
</div>
