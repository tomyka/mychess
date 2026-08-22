<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';

  let { data, form } = $props<{ data: any; form: any }>();
  let searchInput = $state(data.search ?? '');

  function initials(entry: any): string {
    return (entry.display_name ?? m.coaches_coach_fallback_name())[0].toUpperCase();
  }

  function runSearch(e: Event) {
    e.preventDefault();
    goto(`?q=${encodeURIComponent(searchInput)}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>{m.seo_coaches_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <h1 class="text-2xl font-bold text-(--color-text)">{m.coaches_page_heading()}</h1>

    {#if form?.error}
      <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800">{form.error}</p>
    {/if}

    <section>
      <h2 class="font-semibold text-(--color-text) mb-3">{m.coaches_active_heading()}</h2>
      {#if data.coaches.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coaches_none_active()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.coaches as rel (rel.id)}
            <li class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center dark:bg-indigo-950 dark:text-indigo-300">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-(--color-text) flex-1">{rel.other.display_name}</span>
              <form method="POST" action="?/unlink" use:enhance>
                <input type="hidden" name="relationship_id" value={rel.id} />
                <button class="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors shrink-0">{m.coaches_remove_button()}</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-(--color-text) mb-3">{m.coaches_pending_heading()}</h2>
      {#if data.pending.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coaches_no_pending()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.pending as rel (rel.id)}
            <li class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center dark:bg-indigo-950 dark:text-indigo-300">
                {initials(rel.other)}
              </div>
              <span class="font-medium text-(--color-text) flex-1">{rel.other.display_name}</span>
              {#if rel.sentByMe}
                <span class="text-sm text-(--color-muted)">{m.coaches_requested_awaiting()}</span>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-(--color-muted) hover:underline">{m.coaches_cancel_button()}</button>
                </form>
              {:else}
                <form method="POST" action="?/accept" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">{m.coaches_accept_button()}</button>
                </form>
                <form method="POST" action="?/decline" use:enhance>
                  <input type="hidden" name="relationship_id" value={rel.id} />
                  <button class="text-sm text-(--color-muted) hover:underline">{m.coaches_decline_button()}</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <h2 class="font-semibold text-(--color-text) mb-3">{m.coaches_find_heading()}</h2>
      <form onsubmit={runSearch} class="mb-4 flex gap-2">
        <input
          bind:value={searchInput}
          placeholder={m.coaches_search_placeholder()}
          class="flex-1 border border-(--color-border) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" class="text-sm bg-gray-100 border border-(--color-border) px-4 py-2 rounded-lg hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">{m.coaches_search_button()}</button>
      </form>
      {#if data.findError}
        <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 dark:bg-red-950 dark:border-red-800">{m.coaches_find_error({ error: data.findError })}</p>
      {/if}
      {#if data.findResults.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coaches_none_found()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.findResults as coach (coach.id)}
            <li class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-4 flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center dark:bg-indigo-950 dark:text-indigo-300">
                {initials(coach)}
              </div>
              <span class="font-medium text-(--color-text) flex-1">{coach.display_name}</span>
              <form method="POST" action="?/request" use:enhance>
                <input type="hidden" name="coach_id" value={coach.id} />
                <button class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">{m.coaches_request_button()}</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>
