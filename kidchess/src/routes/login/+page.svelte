<script lang="ts">
	import { createSupabaseClient } from '$lib/supabase/client';

	const sb = createSupabaseClient();

	let email = $state('');
	let password = $state('');
	let mode = $state<'login' | 'signup'>('login');
	let error = $state('');
	let loading = $state(false);

	async function submit() {
		loading = true;
		error = '';
		try {
			const fn = mode === 'login'
				? sb.auth.signInWithPassword({ email, password })
				: sb.auth.signUp({ email, password });
			const { error: err } = await fn;
			if (err) { error = err.message; loading = false; }
			else { window.location.href = '/'; }
		} catch (e: any) {
			error = e.message ?? 'Something went wrong';
			loading = false;
		}
	}
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8 p-6">
	<div class="text-center">
		<h1 class="text-6xl font-bold text-yellow-400">KidChess ♞</h1>
		<p class="mt-3 text-slate-300 text-lg">Learn openings. Have fun. Level up!</p>
	</div>

	<div class="bg-slate-800 rounded-2xl p-8 w-full max-w-sm flex flex-col gap-4">
		<div class="flex rounded-xl overflow-hidden border border-slate-700">
			<button
				onclick={() => { mode = 'login'; error = ''; }}
				class="flex-1 py-2 text-sm font-semibold transition {mode === 'login' ? 'bg-yellow-400 text-slate-900' : 'text-slate-400 hover:text-white'}">
				Log In
			</button>
			<button
				onclick={() => { mode = 'signup'; error = ''; }}
				class="flex-1 py-2 text-sm font-semibold transition {mode === 'signup' ? 'bg-yellow-400 text-slate-900' : 'text-slate-400 hover:text-white'}">
				Sign Up
			</button>
		</div>

		<input
			type="email"
			bind:value={email}
			placeholder="Email"
			class="bg-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-yellow-400"
		/>
		<input
			type="password"
			bind:value={password}
			placeholder="Password"
			onkeydown={(e) => e.key === 'Enter' && submit()}
			class="bg-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-yellow-400"
		/>

		{#if error}
			<p class="text-red-400 text-sm">{error}</p>
		{/if}

		<button
			onclick={submit}
			disabled={loading || !email || !password}
			class="bg-yellow-400 text-slate-900 font-bold py-3 rounded-xl hover:bg-yellow-300 transition disabled:opacity-50">
			{loading ? '...' : mode === 'login' ? 'Log In' : 'Create Account'}
		</button>
	</div>
</main>
