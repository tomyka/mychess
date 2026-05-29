<script lang="ts">
  import { enhance } from '$app/forms';

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

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Connected accounts</h2>
      <form method="POST" action="?/save" use:enhance class="space-y-4">
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
          <p class="text-xs text-gray-400 mt-1">Your FIDE ID number (find it at ratings.fide.com)</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="chesscom">Chess.com username</label>
          <input
            id="chesscom"
            name="chesscom_username"
            type="text"
            value={d.chesscomUsername}
            placeholder="e.g. MagnusCarlsen"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="lichess">Lichess username</label>
          <input
            id="lichess"
            name="lichess_username"
            type="text"
            value={d.lichessUsername}
            placeholder="e.g. DrNykterstein"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <button
          type="submit"
          class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Save
        </button>
      </form>
    </section>

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Import games</h2>
      <p class="text-sm text-gray-500 mb-4">
        Import your recent games as a new repertoire. Connect your platform usernames above first.
      </p>

      {#if importResult}
        <p class="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4">
          {importResult}
        </p>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={() => importGames('chesscom')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'chesscom' ? 'Importing…' : 'Import from Chess.com'}
        </button>
        <button
          onclick={() => importGames('lichess')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'lichess' ? 'Importing…' : 'Import from Lichess'}
        </button>
      </div>
    </section>
  </div>
</div>
