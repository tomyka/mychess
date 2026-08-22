<script lang="ts">
	import PgnImportForm from '$lib/components/PgnImportForm.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.seo_coach_pgn_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/coach" class="text-(--color-muted) text-sm hover:text-gray-600 dark:hover:text-gray-400 mb-6 block">{m.coach_back_to_dashboard_link()}</a>
		<h1 class="text-2xl font-bold text-(--color-text) mb-6">{m.coach_pgn_heading()}</h1>

		<PgnImportForm submitLabel={m.coach_pgn_submit_label()} redirectTo="/coach/repertoires" />
	</div>
</main>
