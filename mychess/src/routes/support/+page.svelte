<script lang="ts">
  // Swap this for the real Stripe Payment Link once one exists (Stripe
  // Dashboard → Payment Links → create a one-time payment). Until then the
  // page shows a "coming soon" notice instead of shipping a dead link.
  const DONATION_URL = '';
</script>

<svelte:head>
  <title>Support MyChess</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-12">
  <h1 class="text-2xl font-bold text-(--color-text) mb-4">Support MyChess</h1>

  <div class="space-y-4 text-(--color-muted) leading-relaxed">
    <p>
      MyChess is free to use and always will be — there's no paywalled tier and
      no feature held back for payment. It's a hobby project, currently running
      on free-tier hosting.
    </p>
    <p>
      If you've gotten value out of it and want to help cover hosting costs as
      usage grows, you're welcome to leave a one-time tip below. It's entirely
      optional and comes with no perks or account changes — just a way to say
      thanks if you'd like to.
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
        Leave a tip
      </a>
    {:else}
      <p class="text-sm text-(--color-muted) italic">
        Donation link coming soon.
      </p>
    {/if}
  </div>
</div>
