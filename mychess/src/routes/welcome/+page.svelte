<script lang="ts">
	let role = $state('kid');
	let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-8 p-6">
	<div class="text-center">
		<h1 class="text-4xl font-bold text-yellow-400">Welcome to MyChess!</h1>
		<p class="mt-2 text-slate-400">Tell us about yourself to get started</p>
	</div>

	{#if form?.error}
		<p class="text-red-400 bg-red-900/20 px-4 py-2 rounded-xl">{form.error}</p>
	{/if}

	<form method="POST" class="flex flex-col gap-4 w-full max-w-sm">
		<label class="flex flex-col gap-2">
			<span class="text-sm text-slate-400 font-medium">Your name</span>
			<input
				name="display_name"
				required
				placeholder="e.g. Alex"
				class="rounded-xl px-4 py-3 bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400"
			/>
		</label>

		<div class="flex gap-3">
			{#each [{ id: 'kid', label: 'I am a Player', icon: '♟️' }, { id: 'coach', label: 'I am a Coach', icon: '👩‍🏫' }] as r}
				<button
					type="button"
					onclick={() => (role = r.id)}
					class="flex-1 py-3 px-2 rounded-xl font-semibold transition-all flex flex-col items-center gap-1
						{role === r.id ? 'bg-yellow-400 text-slate-900 scale-105' : 'bg-slate-700 text-white hover:bg-slate-600'}"
				>
					<span class="text-2xl">{r.icon}</span>
					<span class="text-sm">{r.label}</span>
				</button>
			{/each}
		</div>

		<input type="hidden" name="role" value={role} />

		<button
			type="submit"
			class="bg-yellow-400 text-slate-900 py-4 rounded-xl font-bold text-lg hover:bg-yellow-300 transition-all hover:scale-105"
		>
			Let's Go! 🚀
		</button>
	</form>
</main>
