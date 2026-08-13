<script lang="ts">
	let { data } = $props<{ data: any }>();
	const students = $derived<any[]>(data.students ?? []);
</script>

<svelte:head>
	<title>Practice Reports — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
	<div class="max-w-2xl mx-auto px-4 py-6 space-y-6">
		<a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Practice Reports</h1>
			<p class="text-gray-500 text-sm">Last 30 days</p>
		</div>

		{#if students.length === 0}
			<div class="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
				<p class="font-medium text-gray-500">No students yet</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each students as s (s.player.id)}
					<li>
						<a href="/coach/players/{s.player.id}"
						   class="block bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
							<div class="flex items-center justify-between mb-2">
								<span class="font-medium text-gray-900">{s.player.display_name}</span>
								<span class="text-gray-400 text-sm">→</span>
							</div>
							<div class="grid grid-cols-4 gap-2 text-center text-sm">
								<div>
									<p class="font-bold text-gray-900">{s.summary.accuracyPct !== null ? `${s.summary.accuracyPct}%` : '—'}</p>
									<p class="text-xs text-gray-400">Accuracy</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">{s.summary.sessionCount}</p>
									<p class="text-xs text-gray-400">Sessions</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">{s.summary.avgSolvedPct !== null ? `${s.summary.avgSolvedPct}%` : '—'}</p>
									<p class="text-xs text-gray-400">Avg solved</p>
								</div>
								<div>
									<p class="font-bold text-gray-900">
										{s.summary.lastPracticedAt ? new Date(s.summary.lastPracticedAt).toLocaleDateString() : '—'}
									</p>
									<p class="text-xs text-gray-400">Last practiced</p>
								</div>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
