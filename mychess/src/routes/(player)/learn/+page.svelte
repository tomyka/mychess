<script lang="ts">
	import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props<{ data: { repertoires: any[]; learnedCount?: number } }>();

	const learnedCount = $derived(data.learnedCount ?? 0);
</script>

<svelte:head>
	<title>{m.learn_page_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-2xl mx-auto px-4 py-6">
		<h1 class="text-2xl font-bold text-(--color-text) mb-1">{m.learn_title()}</h1>
		<p class="text-sm text-(--color-muted) mb-4">
			{m.learn_intro_prefix()}
			<a href="/practice" class="text-(--color-accent) hover:underline">{m.learn_practice_to_link()}</a>.
		</p>

		{#if data.repertoires.length === 0}
			<div class="text-center py-16 text-(--color-muted)">
				{#if learnedCount > 0}
					<p class="text-4xl mb-4">🎓</p>
					<p class="font-semibold text-lg text-(--color-muted)">{m.learn_nothing_left_title()}</p>
					<p class="text-sm mt-1">
						{m.learn_fully_learned_prefix({ count: learnedCount })}
						<a href="/practice" class="text-(--color-accent) hover:underline">{m.learn_practice_in_link()}</a>.
					</p>
				{:else}
					<p class="text-4xl mb-4">📚</p>
					<p class="font-semibold text-lg text-(--color-muted)">{m.learn_no_repertoires_title()}</p>
					<p class="text-sm mt-1">{m.learn_no_repertoires_body()}</p>
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
					{m.learn_repertoires_live({ count: learnedCount })}
					<a href="/practice" class="text-(--color-accent) hover:underline">{m.learn_practice_in_link()}</a>.
				</p>
			{/if}
		{/if}
	</div>
</main>
