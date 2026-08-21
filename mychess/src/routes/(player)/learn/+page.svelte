<script lang="ts">
	import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';

	let { data } = $props<{ data: { repertoires: any[]; learnedCount?: number } }>();

	const learnedCount = $derived(data.learnedCount ?? 0);
</script>

<svelte:head>
	<title>Learn — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-2xl mx-auto px-4 py-6">
		<h1 class="text-2xl font-bold text-(--color-text) mb-1">Learn</h1>
		<p class="text-sm text-(--color-muted) mb-4">
			Work through new material. A line you play through once from memory, unaided, moves to
			<a href="/practice" class="text-(--color-accent) hover:underline">Practice</a>.
		</p>

		{#if data.repertoires.length === 0}
			<div class="text-center py-16 text-(--color-muted)">
				{#if learnedCount > 0}
					<p class="text-4xl mb-4">🎓</p>
					<p class="font-semibold text-lg text-(--color-muted)">Nothing left to learn</p>
					<p class="text-sm mt-1">
						{learnedCount === 1 ? 'Your repertoire is' : `All ${learnedCount} of your repertoires are`} fully
						learned — keep {learnedCount === 1 ? 'it' : 'them'} sharp in
						<a href="/practice" class="text-(--color-accent) hover:underline">Practice</a>.
					</p>
				{:else}
					<p class="text-4xl mb-4">📚</p>
					<p class="font-semibold text-lg text-(--color-muted)">No repertoires yet</p>
					<p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
				{/if}
			</div>
		{:else}
			<ul class="space-y-2">
				{#each data.repertoires as rep (rep.id)}
					<RepertoirePracticeRow {rep} mode="learn" />
				{/each}
			</ul>
			{#if learnedCount > 0}
				<!-- Says where the finished ones went, so a repertoire vanishing from
				     this list doesn't read as lost. -->
				<p class="text-sm text-(--color-muted) mt-4">
					{learnedCount} fully learned {learnedCount === 1 ? 'repertoire lives' : 'repertoires live'} in
					<a href="/practice" class="text-(--color-accent) hover:underline">Practice</a>.
				</p>
			{/if}
		{/if}
	</div>
</main>
