<script lang="ts">
	import PgnUpload from '$lib/components/PgnUpload.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props<{ data: { kids: any[] }; form: any }>();
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
	<a href="/coach" class="text-slate-400 text-sm mb-6 block">Back to Dashboard</a>
	<h1 class="text-3xl font-bold text-yellow-400 mb-6">Upload Repertoire</h1>

	{#if form?.success}
		<div class="bg-green-900/30 border border-green-500/30 rounded-2xl p-5 mb-6">
			<p class="text-green-400 font-bold">{form.gameCount} game(s) imported!</p>
			<a href="/coach" class="text-sm text-green-300 hover:underline mt-1 block">Back to Dashboard</a>
		</div>
	{/if}
	{#if form?.error}
		<p class="text-red-400 mb-4 bg-red-900/20 px-4 py-2 rounded-xl">{form.error}</p>
	{/if}

	<form method="POST" action="?/upload" use:enhance class="space-y-5">
		<label class="flex flex-col gap-2">
			<span class="text-sm text-slate-400 font-medium">Repertoire Name</span>
			<input name="name" required placeholder="e.g. Sicilian Defense"
				class="rounded-xl px-4 py-3 bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400" />
		</label>

		{#if data.kids.length > 0}
			<label class="flex flex-col gap-2">
				<span class="text-sm text-slate-400 font-medium">Assign to player</span>
				<select name="kid_id" class="rounded-xl px-4 py-3 bg-slate-800 border border-slate-600 text-white focus:outline-none focus:border-yellow-400">
					<option value="">Myself</option>
					{#each data.kids as kid}
						<option value={kid.id}>{kid.display_name}</option>
					{/each}
				</select>
			</label>
		{/if}

		<label class="flex flex-col gap-2">
			<span class="text-sm text-slate-400 font-medium">Paste PGN text</span>
			<textarea name="pgn_text" rows="8"
				placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
				class="rounded-xl px-4 py-3 bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-yellow-400 font-mono text-sm resize-none"
			></textarea>
		</label>

		<button type="submit" class="w-full bg-yellow-400 text-slate-900 py-4 rounded-xl font-bold text-lg hover:bg-yellow-300 transition hover:scale-105">
			Upload Repertoire
		</button>
	</form>
</main>
