<script lang="ts">
  import type { PageData } from './$types';
  import { m } from '$lib/paraglide/messages';

  const { data } = $props<{ data: PageData }>();
</script>

<svelte:head>
  <title>{m.join_needs_login_title()}</title>
</svelte:head>

<div class="min-h-[70vh] flex items-center justify-center px-4">
  <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-4 text-center">
    {#if !data.valid}
      <h1 class="text-lg font-semibold text-(--color-text)">{m.join_invalid_title()}</h1>
      <p class="text-sm text-(--color-muted)">{m.join_invalid_body()}</p>
    {:else if data.needsLogin}
      <h1 class="text-lg font-semibold text-(--color-text)">{m.join_needs_login_title()}</h1>
      <p class="text-sm text-(--color-muted)">{m.join_needs_login_body()}</p>
      <a
        href="/login"
        class="mt-1 inline-block bg-(--color-accent) text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        {m.join_needs_login_cta()}
      </a>
    {:else if data.needsProfile}
      <h1 class="text-lg font-semibold text-(--color-text)">{m.join_needs_profile_title()}</h1>
      <p class="text-sm text-(--color-muted)">{m.join_needs_profile_body()}</p>
      <a
        href="/welcome"
        class="mt-1 inline-block bg-(--color-accent) text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
      >
        {m.join_needs_profile_cta()}
      </a>
    {/if}
  </div>
</div>
