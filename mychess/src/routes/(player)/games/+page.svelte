<script lang="ts">
	import { enhance } from '$app/forms';
	import { summarizeAnalysis } from '$lib/games/summary';

	let { data } = $props<{ data: { games: any[] } }>();
	const games = $derived(data.games);
</script>

<svelte:head>
	<title>My Games — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-3xl mx-auto px-4 py-8">
		<div class="flex items-center justify-between mb-6">
			<h1 class="text-2xl font-bold text-(--color-text)">My Games</h1>
			<a
				href="/games/new"
				class="bg-(--color-accent) text-white px-4 py-2 rounded-xl font-semibold hover:bg-(--color-accent-hover) transition-colors"
				>Upload a game</a
			>
		</div>

		{#if games.length === 0}
			<p class="text-(--color-muted)">No games uploaded yet.</p>
		{:else}
			<ul class="space-y-3">
				{#each games as game (game.id)}
					{@const summary = summarizeAnalysis(game.analysis)}
					<li
						class="bg-(--color-surface) border border-(--color-border) rounded-xl p-4 flex items-center justify-between gap-4"
					>
						<a href="/games/{game.id}" class="flex-1 min-w-0">
							<p class="font-semibold text-(--color-text) truncate">
								{game.headers?.White ?? '?'} vs {game.headers?.Black ?? '?'}
							</p>
							<p class="text-sm text-(--color-muted)">
								{game.headers?.Result ?? '*'} · {game.headers?.Date ?? ''}
								{#if game.analysis_status === 'pending'}
									· Not yet analyzed
								{:else if summary}
									· {summary.blunders} blunders, {summary.mistakes} mistakes, {summary.inaccuracies} inaccuracies
								{/if}
							</p>
						</a>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="game_id" value={game.id} />
							<button type="submit" class="text-red-600 dark:text-red-400 text-sm font-medium hover:underline"
								>Delete</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
