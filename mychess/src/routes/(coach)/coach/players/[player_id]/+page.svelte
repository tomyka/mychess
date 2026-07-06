<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();

  let assignModalOpen = $state(false);
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
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-gray-900">Repertoires</h2>
        {#if data.coachReps.length > 0}
          <button
            type="button"
            onclick={() => (assignModalOpen = true)}
            aria-label="Assign repertoires"
            title="Assign repertoires"
            class="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors font-bold"
          >
            +
          </button>
        {/if}
      </div>

      {#if data.coachReps.length === 0}
        <p class="text-gray-400 text-sm mb-3">
          You haven't uploaded any repertoires yet.
          <a href="/coach/pgn" class="text-indigo-600 hover:underline">Upload one</a> first.
        </p>
      {/if}

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

{#if assignModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
    onclick={() => (assignModalOpen = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-white rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 class="font-semibold text-gray-900 truncate">Repertoires for {data.player?.display_name ?? 'Student'}</h2>
        <button
          type="button"
          onclick={() => (assignModalOpen = false)}
          aria-label="Close"
          class="text-gray-400 hover:text-gray-600 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div class="p-4">
        <ul class="space-y-2">
          {#each data.coachReps as rep}
            {@const isAssigned = data.assignedReps.some((a: any) => a.repertoire?.id === rep.id)}
            <li class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
                <span class="text-sm text-gray-800 truncate">{rep.name}</span>
              </span>
              {#if isAssigned}
                <form method="POST" action="?/unassignRep" use:enhance>
                  <input type="hidden" name="rep_id" value={rep.id} />
                  <button class="text-sm text-red-600 hover:underline shrink-0">Remove</button>
                </form>
              {:else}
                <form method="POST" action="?/assignRep" use:enhance>
                  <input type="hidden" name="rep_id" value={rep.id} />
                  <button class="text-sm bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 transition-colors shrink-0">
                    Assign
                  </button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{/if}
