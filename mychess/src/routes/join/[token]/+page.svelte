<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  let { data } = $props<{ data: any }>();

  const sb = createSupabaseClient();

  async function signIn() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/join/${data.token}` }
    });
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  {#if !data.valid}
    <div class="text-center">
      <p class="text-5xl mb-4">✕</p>
      <h1 class="text-2xl font-bold text-red-600">Invalid Invite</h1>
      <p class="text-gray-500 mt-2">This link is invalid or has expired.</p>
      <a href="/" class="mt-4 inline-block text-indigo-600 hover:underline text-sm">Go to dashboard →</a>
    </div>
  {:else if data.needsLogin}
    <div class="text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-10 max-w-sm w-full">
      <span class="text-4xl">♟</span>
      <h1 class="text-2xl font-bold text-gray-900 mt-3">You've been invited to mychess</h1>
      <p class="text-gray-500 mt-2 mb-8">Sign in to join your coach and start training.</p>
      <button
        onclick={signIn}
        class="flex items-center justify-center gap-3 w-full bg-white border border-gray-300 text-gray-700 px-8 py-3.5 rounded-xl font-semibold hover:bg-gray-50 transition">
        Sign in with Google to accept
      </button>
    </div>
  {:else}
    <div class="text-center">
      <p class="text-gray-600">Setting up your account…</p>
    </div>
  {/if}
</main>
