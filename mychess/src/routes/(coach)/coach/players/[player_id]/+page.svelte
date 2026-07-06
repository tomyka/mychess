<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();
</script>

<svelte:head>
  <title>{data.player?.display_name ?? 'Student'} — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900">{data.player?.display_name ?? 'Student'}</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Stats</h2>
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-indigo-600">{data.stats?.level ?? 0}</p>
          <p class="text-xs text-gray-400">Level</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.total_reviews ?? 0}</p>
          <p class="text-xs text-gray-400">Reviews</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.moves_learned ?? 0}</p>
          <p class="text-xs text-gray-400">Moves learned</p>
        </div>
      </div>
    </section>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Assign a Repertoire</h2>
      {#if data.coachReps.length === 0}
        <p class="text-gray-400 text-sm">
          You haven't uploaded any repertoires yet.
          <a href="/coach/pgn" class="text-indigo-600 hover:underline">Upload one</a> first.
        </p>
      {:else}
        <form method="POST" action="?/assignRep" use:enhance class="flex gap-2">
          <select name="rep_id"
                  class="flex-1 rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {#each data.coachReps as rep}
              <option value={rep.id}>{rep.name}</option>
            {/each}
          </select>
          <button class="bg-indigo-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            Assign
          </button>
        </form>
      {/if}

      <h3 class="text-sm font-medium text-gray-700 mt-5 mb-2">Already assigned</h3>
      {#if data.assignedReps.length === 0}
        <p class="text-gray-400 text-sm">Nothing assigned yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.assignedReps as a}
            <li class="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0"
                    style="background:{a.repertoire?.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <span class="text-sm text-gray-900">{a.repertoire?.name}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Notes</h2>
      <form method="POST" action="?/addNote" use:enhance class="flex gap-2 mb-4">
        <input name="note" placeholder="Leave a note for this student…"
               class="flex-1 rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button class="bg-indigo-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Add
        </button>
      </form>
      {#if data.notes.length === 0}
        <p class="text-gray-400 text-sm">No notes yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.notes as note}
            <li class="bg-gray-50 rounded-lg p-3">
              <p class="text-sm text-gray-900">{note.note}</p>
              <p class="text-xs text-gray-400 mt-1">{new Date(note.created_at).toLocaleDateString()}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
