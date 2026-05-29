<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  import { page } from '$app/stores';

  const sb = createSupabaseClient();

  let email = $state('');
  let password = $state('');
  let mode = $state<'login' | 'signup'>($page.url.searchParams.get('signup') === '1' ? 'signup' : 'login');
  let error = $state('');
  let loading = $state(false);

  async function submit() {
    loading = true;
    error = '';
    try {
      if (mode === 'login') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) { error = err.message; loading = false; return; }
      } else {
        const { data: { user } } = await sb.auth.getUser();
        if (user?.is_anonymous) {
          const { error: err } = await sb.auth.updateUser({ email, password });
          if (err) { error = err.message; loading = false; return; }
        } else {
          const { error: err } = await sb.auth.signUp({ email, password });
          if (err) { error = err.message; loading = false; return; }
        }
      }
      window.location.href = '/';
    } catch (e: any) {
      error = e.message ?? 'Something went wrong';
      loading = false;
    }
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">mychess</span>
    </a>
    <p class="text-gray-500">Your daily chess dashboard</p>
  </div>

  {#if mode === 'signup'}
    <p class="text-indigo-700 text-sm bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 max-w-sm text-center">
      Create a free account to save your progress forever.
    </p>
  {/if}

  <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    <div class="flex rounded-lg overflow-hidden border border-gray-200">
      <button
        onclick={() => { mode = 'login'; error = ''; }}
        class="flex-1 py-2 text-sm font-semibold transition {mode === 'login' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}">
        Sign in
      </button>
      <button
        onclick={() => { mode = 'signup'; error = ''; }}
        class="flex-1 py-2 text-sm font-semibold transition {mode === 'signup' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}">
        Create account
      </button>
    </div>

    {#if error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
    {/if}

    <div class="flex flex-col gap-3">
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
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="••••••••"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    </div>

    <button
      onclick={submit}
      disabled={loading}
      class="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50">
      {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
    </button>

    <a href="/" class="text-center text-sm text-gray-500 hover:underline">Continue without account →</a>
  </div>
</main>
