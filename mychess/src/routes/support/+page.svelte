<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  // Swap this for the real Stripe Payment Link once one exists (Stripe
  // Dashboard → Payment Links → create a one-time payment). Until then the
  // page shows a "coming soon" notice instead of shipping a dead link.
  const DONATION_URL = '';
</script>

<svelte:head>
  <title>{m.seo_support_title()}</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-12">
  <h1 class="text-2xl font-bold text-(--color-text) mb-4">{m.support_heading()}</h1>

  <div class="space-y-4 text-(--color-muted) leading-relaxed">
    <p>
      {m.support_intro_body()}
    </p>
    <p>
      {m.support_tip_body()}
    </p>
  </div>

  <div class="mt-8">
    {#if DONATION_URL}
      <a
        href={DONATION_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors"
      >
        {m.support_leave_tip_button()}
      </a>
    {:else}
      <p class="text-sm text-(--color-muted) italic">
        {m.support_donation_coming_soon()}
      </p>
    {/if}
  </div>
</div>
