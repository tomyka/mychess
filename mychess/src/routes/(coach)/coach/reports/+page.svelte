<script lang="ts">
	let { data } = $props<{ data: any }>();
	const students = $derived<any[]>(data.students ?? []);
</script>

<svelte:head>
	<title>Practice Reports — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-2xl mx-auto px-4 py-6 space-y-6">
		<a href="/coach" class="text-(--color-muted) text-sm hover:text-gray-600 dark:hover:text-gray-400 block">← Back to Dashboard</a>
		<div>
			<h1 class="text-2xl font-bold text-(--color-text)">Practice Reports</h1>
			<!-- Scope matters and used to be implicit: these figures are summed
			     ACROSS every repertoire a student has, whereas the per-repertoire
			     cards on the student's own page below count each repertoire
			     separately. A day spent on two repertoires is one session here
			     and two there, so both pages now say which they mean. -->
			<p class="text-(--color-muted) text-sm">Last 30 days · across all repertoires</p>
		</div>

		{#if students.length === 0}
			<div class="bg-(--color-surface) border border-(--color-border) rounded-xl p-8 text-center text-(--color-muted)">
				<p class="font-medium text-(--color-muted)">No students yet</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each students as s (s.player.id)}
					<li>
						<a href="/coach/players/{s.player.id}"
						   class="block bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
							<div class="flex items-center justify-between mb-2">
								<span class="font-medium text-(--color-text)">{s.player.display_name}</span>
								<span class="text-(--color-muted) text-sm">→</span>
							</div>
							<div class="grid grid-cols-4 gap-2 text-center text-sm">
								<div>
									<p class="font-bold text-(--color-text)">{s.summary.accuracyPct !== null ? `${s.summary.accuracyPct}%` : '—'}</p>
									<p class="text-xs text-(--color-muted)">Accuracy</p>
								</div>
								<div>
									<p class="font-bold text-(--color-text)">{s.summary.sessionCount}</p>
									<p class="text-xs text-(--color-muted)">Sessions</p>
								</div>
								<div>
									<p class="font-bold text-(--color-text)">{s.summary.avgSolvedPct !== null ? `${s.summary.avgSolvedPct}%` : '—'}</p>
									<p class="text-xs text-(--color-muted)">Avg solved</p>
								</div>
								<div>
									<p class="font-bold text-(--color-text)">
										{s.summary.lastPracticedAt ? new Date(s.summary.lastPracticedAt).toLocaleDateString() : '—'}
									</p>
									<p class="text-xs text-(--color-muted)">Last practiced</p>
								</div>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
