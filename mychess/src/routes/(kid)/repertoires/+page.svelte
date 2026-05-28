<script lang="ts">
	let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
	<h1 class="text-3xl font-bold text-yellow-400 mb-6">My Repertoires</h1>

	{#if data.repertoires.length === 0}
		<div class="text-center py-16 text-slate-400">
			<p class="text-5xl mb-4">📚</p>
			<p class="font-semibold text-lg">No repertoires yet</p>
			<p class="text-sm mt-1">Ask your coach to upload a PGN for you!</p>
		</div>
	{:else}
		<ul class="space-y-3">
			{#each data.repertoires as rep}
				<li>
					<a href="/repertoires/{rep.id}" class="block bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition">
						<div class="flex items-center gap-3">
							<span class="w-4 h-4 rounded-full shrink-0" style="background:{rep.color ?? '#facc15'}"></span>
							<div class="flex-1 min-w-0">
								<h2 class="font-bold text-lg truncate">{rep.name}</h2>
								<p class="text-sm text-slate-400">{rep.moves?.[0]?.count ?? 0} moves</p>
							</div>
							<span class="text-slate-500">→</span>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
