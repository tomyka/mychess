<script lang="ts">
  import { sendMagicLink } from '$lib/auth/client';

  let { data } = $props<{ data: { error: string | null } }>();

  let email = $state('');
  let keepSignedIn = $state(true);
  let error = $state(data.error ?? '');
  let loading = $state(false);
  let sent = $state(false);

  async function magicLink() {
    if (!email.trim()) { error = 'Enter your email address'; return; }
    loading = true; error = '';
    const r = await sendMagicLink(email.trim(), keepSignedIn);
    loading = false;
    if (r.ok) sent = true;
    else error = r.error ?? 'Could not send the link';
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-(--color-bg) gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-(--color-text) mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </a>
    <p class="text-(--color-muted)">Sign in to save your progress</p>
  </div>

  <div class="bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    {#if error}
      <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800">{error}</p>
    {/if}

    {#if sent}
      <div class="text-center space-y-2">
        <h1 class="text-lg font-semibold text-(--color-text)">Check your email</h1>
        <p class="text-sm text-(--color-muted)">We sent a sign-in link to <span class="font-medium">{email}</span>. Open it on this device to continue.</p>
        <button onclick={() => { sent = false; }} class="text-sm text-(--color-accent) hover:underline">Use a different email</button>
      </div>
    {:else}
      <a
        href={`/auth/google?persist=${keepSignedIn ? '1' : '0'}`}
        class="flex items-center justify-center gap-2 border border-(--color-border) rounded-xl py-3 font-medium text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800 transition">
        <span aria-hidden="true">G</span> Continue with Google
      </a>

      <div class="flex items-center gap-3 text-xs text-(--color-muted)">
        <span class="flex-1 border-t border-(--color-border)"></span>or<span class="flex-1 border-t border-(--color-border)"></span>
      </div>

      <div>
        <label class="block text-sm font-medium text-(--color-text) mb-1" for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="you@example.com"
          class="w-full border border-(--color-border) rounded-lg px-4 py-2.5 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <label class="flex items-center gap-2 text-sm text-(--color-muted)">
        <input type="checkbox" bind:checked={keepSignedIn} class="rounded border-(--color-border) text-(--color-accent) focus:ring-indigo-500" />
        Keep me signed in
      </label>

      <button
        onclick={magicLink}
        disabled={loading}
        class="bg-(--color-accent) text-white py-3 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition disabled:opacity-50">
        {loading ? 'Please wait…' : 'Email me a magic link'}
      </button>
    {/if}

    <a href="/" class="text-center text-sm text-(--color-muted) hover:underline">Continue without account →</a>
  </div>
</main>
