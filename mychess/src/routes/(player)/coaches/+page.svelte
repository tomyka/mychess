<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';

  let { data, form } = $props<{ data: any; form: any }>();
  let searchInput = $state(data.search ?? '');

  function initials(entry: any): string {
    return (entry.display_name ?? 'C')[0].toUpperCase();
  }

  function runSearch(e: Event) {
    e.preventDefault();
    goto(`?q=${encodeURIComponent(searchInput)}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>My Coaches — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <h1 class="text-2xl font-bold text-gray-900">My Coaches</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Active</h2>
      {#if data.coaches.length === 0}
        <p class="text-gray-400 text-sm">No coaches yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.coaches as rel (rel.id)}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{rel.other.display_name}</span>
              <form method="POST" action="?/unlink" use:enhance>
                <input type="hidden" name="relationship_id" value={rel.id} />
                <button class="text-sm text-red-600 hover:underline">Remove</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Pending</h2>
      {#if data.pending.length === 0}
        <p class="text-gray-400 text-sm">No pending requests.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.pending as rel (rel.id)}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{rel.other.display_name}</span>
              {#if rel.sentByMe}
                <span class="text-sm text-gray-400">Requested — awaiting response</span>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Cancel</button>
                </form>
              {:else}
                <form method="POST" action="?/accept" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Accept</button>
                </form>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-gray-500 hover:underline">Decline</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-gray-900 mb-3">Find a Coach</h2>
      <form onsubmit={runSearch} class="mb-4 flex gap-2">
        <input
          bind:value={searchInput}
          placeholder="Search by name…"
          class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" class="text-sm bg-gray-100 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-200">Search</button>
      </form>
      {#if data.findError}
        <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">Error loading coaches: {data.findError}</p>
      {/if}
      {#if data.findResults.length === 0}
        <p class="text-gray-400 text-sm">No coaches found.</p>
      {:else}
        <ul class="space-y-2">
          {#each data.findResults as coach (coach.id)}
            <li class="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                {initials(coach)}
              </div>
              <span class="font-medium text-gray-900 flex-1">{coach.display_name}</span>
              <form method="POST" action="?/request" use:enhance>
                <input type="hidden" name="coach_id" value={coach.id} />
                <button class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">Request</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
