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

<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8 p-6">
	{#if !data.valid}
		<div class="text-center">
			<p class="text-6xl mb-4">❌</p>
			<h1 class="text-2xl font-bold text-red-400">Invalid Invite</h1>
			<p class="text-slate-400 mt-2">This link is invalid or has expired.</p>
		</div>
	{:else if data.needsLogin}
		<div class="text-center">
			<p class="text-6xl mb-4">🏆</p>
			<h1 class="text-3xl font-bold text-yellow-400">You've been invited to KidChess!</h1>
			<p class="text-slate-400 mt-2 mb-8">Sign in to join your coach and start learning.</p>
		</div>
		<button
			onclick={signIn}
			class="flex items-center gap-3 bg-white text-slate-900 px-8 py-4 rounded-2xl font-bold text-lg hover:scale-105 transition"
		>
			Sign in with Google to Accept
		</button>
	{:else}
		<div class="text-center">
			<p class="text-4xl mb-4">⚙️</p>
			<p class="text-slate-300">Setting up your account...</p>
		</div>
	{/if}
</main>
