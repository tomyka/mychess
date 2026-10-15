<script lang="ts">
	import { enhance } from '$app/forms';
	import { summarizeAnalysis } from '$lib/games/summary';
	import { m } from '$lib/paraglide/messages';

	let { data, form } = $props<{ data: { games: any[] }; form?: any }>();
	const games = $derived(data.games);

	function confirmDelete(e: SubmitEvent) {
		if (!confirm(m.games_delete_confirm())) {
			e.preventDefault();
		}
	}
</script>

<svelte:head>
	<title>{m.seo_games_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-3xl mx-auto px-4 py-8">
		{#if form?.error}
			<p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800 mb-6">{form.error}</p>
		{/if}

		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold text-(--color-text)">{m.games_heading()}</h1>
			<a
				href="/games/new"
				class="bg-(--color-accent) text-white px-4 py-2 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition-colors"
				>{m.games_upload_button()}</a
			>
		</div>

		{#if games.length === 0}
			<p class="text-(--color-muted)">{m.games_empty()}</p>
		{:else}
			<ul class="space-y-3">
				{#each games as game (game.id)}
					{@const summary = summarizeAnalysis(game.analysis)}
					<li
						class="bg-(--color-surface) border border-(--color-border) rounded-xl p-4 flex items-center justify-between gap-4"
					>
						<a href="/games/{game.id}" class="flex-1 min-w-0">
							<p class="font-semibold text-(--color-text) truncate">
								{game.headers?.White ?? '?'} {m.games_vs()} {game.headers?.Black ?? '?'}
							</p>
							<p class="text-sm text-(--color-muted)">
								{game.headers?.Result ?? '*'} · {game.headers?.Date ?? ''}
								{#if game.analysis_status === 'pending'}
									· {m.games_not_yet_analyzed()}
								{:else if summary}
									· {m.games_blunder_count({ count: summary.blunders })}, {m.games_mistake_count({
										count: summary.mistakes
									})}, {m.games_inaccuracy_count({ count: summary.inaccuracies })}
								{/if}
							</p>
						</a>
						<form method="POST" action="?/delete" use:enhance onsubmit={confirmDelete}>
							<input type="hidden" name="game_id" value={game.id} />
							<button type="submit" class="text-red-600 dark:text-red-400 text-sm font-medium hover:underline"
								>{m.games_delete_button()}</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
