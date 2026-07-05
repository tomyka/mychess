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

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </a>
    <p class="text-gray-500">Sign in to save your progress</p>
  </div>

  <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    {#if error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
    {/if}

    {#if sent}
      <div class="text-center space-y-2">
        <h1 class="text-lg font-semibold text-gray-900">Check your email</h1>
        <p class="text-sm text-gray-500">We sent a sign-in link to <span class="font-medium">{email}</span>. Open it on this device to continue.</p>
        <button onclick={() => { sent = false; }} class="text-sm text-indigo-600 hover:underline">Use a different email</button>
      </div>
    {:else}
      <a
        href={`/auth/google?persist=${keepSignedIn ? '1' : '0'}`}
        class="flex items-center justify-center gap-2 border border-gray-300 rounded-xl py-3 font-medium text-gray-700 hover:bg-gray-50 transition">
        <span aria-hidden="true">G</span> Continue with Google
      </a>

      <div class="flex items-center gap-3 text-xs text-gray-400">
        <span class="flex-1 border-t border-gray-200"></span>or<span class="flex-1 border-t border-gray-200"></span>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="you@example.com"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" bind:checked={keepSignedIn} class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        Keep me signed in
      </label>

      <button
        onclick={magicLink}
        disabled={loading}
        class="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50">
        {loading ? 'Please wait…' : 'Email me a magic link'}
      </button>
    {/if}

    <a href="/" class="text-center text-sm text-gray-500 hover:underline">Continue without account →</a>
  </div>
</main>
