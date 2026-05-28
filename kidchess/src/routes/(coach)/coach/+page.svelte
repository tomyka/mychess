<script lang="ts">
	let { data } = $props<{ data: any }>();
	const profile = $derived(data.profile as any);
	const kids = $derived<any[]>(data.kids ?? []);
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-2xl mx-auto">
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-3xl font-bold text-yellow-400">Coach Dashboard</h1>
			<p class="text-slate-400">Welcome back, {profile?.display_name ?? 'Coach'}!</p>
		</div>
		<a href="/coach/invite" class="bg-yellow-400 text-slate-900 px-5 py-3 rounded-2xl font-bold hover:bg-yellow-300 transition">
			+ Invite Player
		</a>
	</div>

	<div class="grid grid-cols-2 gap-4 mb-8">
		<a href="/coach/invite" class="bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition">
			<p class="text-3xl mb-2">🔗</p>
			<p class="font-bold">Invite Links</p>
			<p class="text-sm text-slate-400">Invite students to join</p>
		</a>
		<a href="/coach/pgn" class="bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition">
			<p class="text-3xl mb-2">📂</p>
			<p class="font-bold">Upload PGN</p>
			<p class="text-sm text-slate-400">Add repertoires</p>
		</a>
	</div>

	{#if kids.length > 0}
		<h2 class="text-xl font-bold mb-4">My Players</h2>
		<ul class="space-y-2">
			{#each kids as kid}
				<li>
					<a href="/coach/kids/{kid.id}" class="flex items-center gap-3 bg-slate-800 rounded-xl p-4 hover:bg-slate-700 transition">
						<span class="text-2xl">♞</span>
						<span class="font-medium">{kid.display_name}</span>
						<span class="ml-auto text-slate-400">→</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="text-center py-10 text-slate-400">
			<p class="text-4xl mb-3">👀</p>
			<p>No players yet. Send an invite link to get started!</p>
		</div>
	{/if}
</main>
