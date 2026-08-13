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
      <div class="grid grid-cols-2 gap-4 text-center">
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
          {#each data.assignedReps as a (a.id)}
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
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-gray-900">Practice Report</h2>
        <div class="flex gap-1 text-xs">
          <a href="?range=30d" aria-current={data.range === '30d' ? 'true' : undefined} class="px-2 py-1 rounded-full {data.range === '30d' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}">30d</a>
          <a href="?range=all" aria-current={data.range === 'all' ? 'true' : undefined} class="px-2 py-1 rounded-full {data.range === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}">All time</a>
        </div>
      </div>

      {#if data.practiceReports.length === 0}
        <p class="text-gray-400 text-sm">No repertoires assigned yet.</p>
      {:else}
        <div class="space-y-4">
          {#each data.practiceReports as pr (pr.repertoireId ?? pr.repertoireName)}
            <div class="bg-gray-50 rounded-lg p-4">
              <h3 class="font-medium text-gray-900 text-sm mb-3">
                {pr.repertoireName}
                <span class="text-gray-400 font-normal">— {pr.total > 0 ? `${pr.solved}/${pr.total} solved` : 'no moves yet'}</span>
              </h3>

              {#if !pr.report || pr.report.accuracy.length === 0}
                <p class="text-gray-400 text-xs">No practice activity in this range.</p>
              {:else}
                <div class="grid grid-cols-3 gap-2 text-center text-sm mb-3">
                  <div>
                    <p class="font-bold text-gray-900">{pr.report.activity.sessionCount}</p>
                    <p class="text-xs text-gray-400">Sessions</p>
                  </div>
                  <div>
                    <p class="font-bold text-gray-900">{pr.report.activity.streakDays}</p>
                    <p class="text-xs text-gray-400">Day streak</p>
                  </div>
                  <div>
                    <p class="font-bold text-gray-900">
                      {pr.report.activity.lastPracticedAt ? new Date(pr.report.activity.lastPracticedAt).toLocaleDateString() : '—'}
                    </p>
                    <p class="text-xs text-gray-400">Last practiced</p>
                  </div>
                </div>

                <svg viewBox="0 0 {pr.report.accuracy.length * 14} 60" class="w-full h-16 mb-1" role="img"
                     aria-label="Accuracy over time for {pr.repertoireName}">
                  {#each pr.report.accuracy as point, i}
                    {@const total = point.correct + point.wrong}
                    {@const wrongH = total === 0 ? 0 : (point.wrong / total) * 46}
                    {@const correctH = total === 0 ? 0 : (point.correct / total) * 46}
                    {@const gap = wrongH > 0 && correctH > 0 ? 2 : 0}
                    <g transform="translate({i * 14}, 0)">
                      <title>{point.bucket}: {point.correct}/{total} correct</title>
                      <rect x="2" y={56 - wrongH} width="10" height={wrongH} rx="2" fill="#f87171" />
                      <rect x="2" y={56 - wrongH - gap - correctH} width="10" height={correctH} rx="2" fill="#4ade80" />
                    </g>
                  {/each}
                </svg>
                <span class="sr-only">
                  {#each pr.report.accuracy as point}
                    {point.bucket}: {point.correct} of {point.correct + point.wrong} correct.
                  {/each}
                </span>
                <div class="flex gap-3 text-xs text-gray-400 mb-3">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400"></span>Correct</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400"></span>Wrong</span>
                </div>

                {#if pr.report.hotspots.length > 0}
                  <p class="text-xs font-medium text-gray-500 mb-1">Mistake hotspots</p>
                  <ul class="text-xs text-gray-700 space-y-0.5">
                    {#each pr.report.hotspots as h (h.moveId)}
                      <li>{h.label} — wrong {h.missCount}/{h.attemptCount}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
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
          {#each data.notes as note (note.id)}
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
          {#each data.coachReps as rep (rep.id)}
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
