<script lang="ts">
	let { data } = $props<{ data: any }>();
	const { kid, stats, repertoires } = $derived(data);
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
	<a href="/coach" class="text-slate-400 text-sm mb-6 block">Back to Dashboard</a>
	<div class="flex items-center gap-4 mb-8">
		<div class="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center text-2xl">♞</div>
		<div>
			<h1 class="text-2xl font-bold">{kid?.display_name}</h1>
			<p class="text-slate-400 text-sm">Level {stats?.level ?? 0} · {stats?.total_xp ?? 0} XP · {stats?.streak_days ?? 0}🔥</p>
		</div>
	</div>

	<div class="bg-slate-700 rounded-full h-2 mb-6 overflow-hidden">
		<div class="h-full bg-yellow-400 transition-all" style="width: {Math.min(100, ((stats?.xpInLevel ?? 0) / (stats?.xpToNextLevel ?? 100)) * 100)}%"></div>
	</div>

	<h2 class="text-xl font-bold mb-4">Repertoires ({repertoires.length})</h2>
	{#if repertoires.length === 0}
		<p class="text-slate-400 mb-6">No repertoires yet.</p>
	{:else}
		<ul class="space-y-2 mb-6">
			{#each repertoires as rep}
				<li class="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
					<span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#facc15'}"></span>
					<span class="font-medium">{rep.name}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<a href="/coach/pgn?kid={kid?.id}" class="block w-full text-center bg-yellow-400 text-slate-900 py-4 rounded-2xl font-bold hover:bg-yellow-300 transition">
		+ Upload Repertoire
	</a>
</main>
