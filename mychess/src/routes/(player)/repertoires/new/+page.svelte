<!-- mychess/src/routes/(player)/repertoires/new/+page.svelte -->
<script lang="ts">
	import PgnImportForm from '$lib/components/PgnImportForm.svelte';
</script>

<svelte:head>
	<title>Create Repertoire — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/repertoires" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-6 block">← Back to Repertoires</a>
		<h1 class="text-2xl font-bold text-(--color-text) mb-6">Create Repertoire</h1>

		<PgnImportForm submitLabel="Create Repertoire" redirectTo="/repertoires" />
	</div>
</main>
