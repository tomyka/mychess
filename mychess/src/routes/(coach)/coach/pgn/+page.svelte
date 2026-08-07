<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props<{ form: any }>();
  let name = $state('');
  let color = $state<'white' | 'black'>('white');
  let pgnText = $state('');
  let fileError = $state('');
  let fileName = $state('');

  function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName = file.name;
    name = file.name.replace(/\.[^/.]+$/, '');
    const reader = new FileReader();
    reader.onload = () => {
      pgnText = reader.result as string;
      fileError = '';
    };
    reader.onerror = () => {
      fileError = 'Could not read that file — try pasting the PGN text instead.';
    };
    reader.readAsText(file);
  }
</script>

<svelte:head>
  <title>Upload Repertoire — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 mb-6 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Upload Repertoire</h1>

    {#if form?.error}
      <p class="text-red-600 mb-4 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
    {/if}

    <form method="POST" action="?/upload" use:enhance
          class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
        <input id="name" name="name" required placeholder="e.g. Sicilian Defense" bind:value={name}
               class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <span class="block text-sm font-medium text-gray-700 mb-1">Color</span>
        <div class="flex gap-3">
          {#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as c (c.id)}
            <button
              type="button"
              onclick={() => (color = c.id)}
              class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                     {color === c.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
            >
              {c.label}
            </button>
          {/each}
        </div>
        <input type="hidden" name="color" value={color} />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_text">Paste PGN text</label>
        <textarea id="pgn_text" name="pgn_text" rows="8" bind:value={pgnText}
                  placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
                  class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none"
        ></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_file">…or upload a .pgn file</label>
        <div class="flex items-center gap-3">
          <label for="pgn_file"
                 class="cursor-pointer inline-block bg-gray-100 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 transition-colors">
            Choose File
          </label>
          <input id="pgn_file" type="file" accept=".pgn" onchange={onFileChange} class="hidden" />
          {#if fileName}
            <span class="text-sm text-gray-500 truncate">{fileName}</span>
          {/if}
        </div>
        {#if fileError}
          <p class="text-red-600 text-sm mt-1">{fileError}</p>
        {/if}
      </div>

      <button type="submit"
              class="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
        Upload Repertoire
      </button>
    </form>
  </div>
</main>
