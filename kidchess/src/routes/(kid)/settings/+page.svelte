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
        importResult = `✅ Imported ${body.count} game(s) as a new repertoire!`;
      } else {
        importResult = `❌ ${body.error ?? 'Import failed'}`;
      }
    } catch {
      importResult = '❌ Network error';
    } finally {
      importing = null;
    }
  }
</script>

<div class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto">
  <div class="flex items-center gap-3 mb-6">
    <a href="/" class="text-2xl">⬅️</a>
    <h1 class="text-2xl font-bold">⚙️ Settings</h1>
  </div>

  <section class="bg-slate-800 rounded-2xl p-5 mb-5">
    <h2 class="font-bold text-lg mb-4 text-yellow-400">🔗 Connect Platforms</h2>
    <form method="POST" action="?/save" use:enhance class="space-y-4">
      <div>
        <label class="block text-sm text-slate-400 mb-1" for="chesscom">Chess.com username</label>
        <input
          id="chesscom"
          name="chesscom_username"
          type="text"
          value={d.chesscomUsername}
          placeholder="e.g. MagnusCarlsen"
          class="w-full bg-slate-700 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1" for="lichess">Lichess username</label>
        <input
          id="lichess"
          name="lichess_username"
          type="text"
          value={d.lichessUsername}
          placeholder="e.g. DrNykterstein"
          class="w-full bg-slate-700 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>
      <button class="w-full bg-yellow-400 text-slate-900 py-2 rounded-xl font-bold hover:bg-yellow-300 transition">
        Save
      </button>
      {#if (form as any)?.success}
        <p class="text-green-400 text-sm">✅ Saved!</p>
      {/if}
    </form>
  </section>

  <section class="bg-slate-800 rounded-2xl p-5 mb-5">
    <h2 class="font-bold text-lg mb-1 text-yellow-400">📥 Import Recent Games</h2>
    <p class="text-slate-400 text-xs mb-4">Import your last 20 games as a new repertoire study set.</p>
    <div class="flex flex-col gap-3">
      <button
        onclick={() => importGames('chesscom')}
        disabled={!d.chesscomUsername || importing !== null}
        class="w-full bg-green-600 py-3 rounded-xl font-bold hover:bg-green-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {importing === 'chesscom' ? 'Importing...' : 'Import from Chess.com'}
      </button>
      <button
        onclick={() => importGames('lichess')}
        disabled={!d.lichessUsername || importing !== null}
        class="w-full bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {importing === 'lichess' ? 'Importing...' : 'Import from Lichess'}
      </button>
    </div>
    {#if importResult}
      <p class="text-sm mt-3 {importResult.startsWith('✅') ? 'text-green-400' : 'text-red-400'}">{importResult}</p>
    {/if}
  </section>
</div>
