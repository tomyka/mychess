<!-- mychess/src/routes/(player)/repertoires/new/+page.svelte -->
<script lang="ts">
	import PgnImportForm from '$lib/components/PgnImportForm.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.seo_repertoires_new_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/repertoires" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-6 block">{m.repertoires_new_back_link()}</a>
		<h1 class="text-2xl font-bold text-(--color-text) mb-6">{m.repertoires_create_action_label()}</h1>

		<PgnImportForm submitLabel={m.repertoires_create_action_label()} redirectTo="/repertoires" />
	</div>
</main>
