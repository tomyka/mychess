<script lang="ts">
	import PgnImportForm from '$lib/components/PgnImportForm.svelte';
</script>

<svelte:head>
	<title>Upload Repertoire — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 mb-6 block">← Back to Dashboard</a>
		<h1 class="text-2xl font-bold text-gray-900 mb-6">Upload Repertoire</h1>

		<PgnImportForm submitLabel="Upload Repertoire" redirectTo="/coach/repertoires" />
	</div>
</main>
