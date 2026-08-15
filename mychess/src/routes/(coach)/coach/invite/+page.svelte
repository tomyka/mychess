<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props<{ data: { invites: any[] }; form: any }>();
  let origin = $derived(typeof window !== 'undefined' ? window.location.origin : '');
</script>

<svelte:head>
  <title>Invite Player — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/coach" class="text-(--color-muted) text-sm hover:text-gray-600 dark:hover:text-gray-400 mb-6 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-(--color-text) mb-6">Invite a Player</h1>

    <form method="POST" action="?/create" use:enhance class="mb-6">
      <button class="bg-(--color-accent) text-white px-6 py-3 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
        Generate Invite Link
      </button>
    </form>

    {#if form?.token}
      <div class="mb-8 bg-(--color-surface) border border-indigo-200 rounded-xl p-5 shadow-sm">
        <p class="text-sm text-(--color-muted) mb-2 font-medium">Share this link:</p>
        <p class="font-mono text-(--color-accent) break-all text-sm">{origin}/join/{form.token}</p>
        <button
          onclick={() => navigator.clipboard.writeText(`${origin}/join/${form.token}`)}
          class="mt-3 text-sm bg-gray-100 border border-(--color-border) px-3 py-1.5 rounded-lg hover:bg-gray-200 transition text-(--color-text) dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          Copy Link
        </button>
      </div>
    {/if}

    <h2 class="text-lg font-semibold text-(--color-text) mb-4">Past Invites</h2>
    {#if data.invites.length === 0}
      <p class="text-(--color-muted)">No invites yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.invites as inv (inv.token)}
          <li class="bg-(--color-surface) border border-(--color-border) rounded-xl p-4 text-sm flex justify-between items-center">
            <span class="font-mono text-(--color-muted) truncate">/join/{inv.token.slice(0, 16)}...</span>
            {#if inv.redeemed_at}
              <span class="text-green-600 font-medium ml-2 shrink-0 dark:text-green-400">Redeemed</span>
            {:else if new Date(inv.expires_at) < new Date()}
              <span class="text-red-500 font-medium ml-2 shrink-0 dark:text-red-400">Expired</span>
            {:else}
              <span class="text-(--color-muted) ml-2 shrink-0">Pending</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
