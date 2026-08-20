<script lang="ts">
	import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';

	let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
	<title>Learn — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-2xl mx-auto px-4 py-6">
		<h1 class="text-2xl font-bold text-(--color-text) mb-1">Learn</h1>
		<p class="text-sm text-(--color-muted) mb-4">
			Work through new material. A line you play cleanly twice, a day apart, moves to
			<a href="/practice" class="text-(--color-accent) hover:underline">Practice</a>.
		</p>

		{#if data.repertoires.length === 0}
			<div class="text-center py-16 text-(--color-muted)">
				<p class="text-4xl mb-4">📚</p>
				<p class="font-semibold text-lg text-(--color-muted)">No repertoires yet</p>
				<p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each data.repertoires as rep (rep.id)}
					<RepertoirePracticeRow {rep} mode="learn" />
				{/each}
			</ul>
		{/if}
	</div>
</main>
