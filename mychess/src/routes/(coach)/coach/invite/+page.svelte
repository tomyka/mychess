<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props<{ data: { invites: any[] }; form: any }>();
	let origin = $state('');
	$effect(() => { origin = typeof window !== 'undefined' ? window.location.origin : ''; });
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
	<a href="/coach" class="text-slate-400 text-sm mb-6 block">Back to Dashboard</a>
	<h1 class="text-3xl font-bold text-yellow-400 mb-6">Invite a Player</h1>

	<form method="POST" action="?/create" use:enhance class="mb-6">
		<button class="bg-yellow-400 text-slate-900 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-yellow-300 transition">
			Generate Invite Link
		</button>
	</form>

	{#if form?.token}
		<div class="mb-8 p-5 bg-slate-800 rounded-2xl border border-yellow-400/30">
			<p class="text-sm text-slate-400 mb-2 font-medium">Share this link:</p>
			<p class="font-mono text-yellow-400 break-all text-sm">{origin}/join/{form.token}</p>
			<button
				onclick={() => navigator.clipboard.writeText(`${origin}/join/${form.token}`)}
				class="mt-3 text-sm bg-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-600 transition"
			>
				Copy Link
			</button>
		</div>
	{/if}

	<h2 class="text-xl font-bold mb-4">Past Invites</h2>
	{#if data.invites.length === 0}
		<p class="text-slate-400">No invites yet.</p>
	{:else}
		<ul class="space-y-2">
			{#each data.invites as inv}
				<li class="bg-slate-800 rounded-xl p-4 text-sm flex justify-between items-center">
					<span class="font-mono text-slate-300 truncate">/join/{inv.token.slice(0, 16)}...</span>
					{#if inv.redeemed_at}
						<span class="text-green-400 font-medium ml-2 shrink-0">Redeemed</span>
					{:else if new Date(inv.expires_at) < new Date()}
						<span class="text-red-400 font-medium ml-2 shrink-0">Expired</span>
					{:else}
						<span class="text-slate-400 ml-2 shrink-0">Pending</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>
