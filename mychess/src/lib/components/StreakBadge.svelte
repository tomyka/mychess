<script lang="ts">
	type Props = { days?: number; hasFreeze?: boolean };
	let { days = 0, hasFreeze = false }: Props = $props();
</script>

<div class="flex items-center gap-2 bg-slate-800 rounded-2xl px-4 py-3">
	<span class="text-2xl">{days > 0 ? '🔥' : '💤'}</span>
	<div>
		<p class="font-bold text-lg leading-none">{days}</p>
		<p class="text-xs text-slate-400">day streak</p>
	</div>
	{#if hasFreeze}
		<span class="ml-2 text-lg" title="Streak freeze available">🧊</span>
	{/if}
</div>
