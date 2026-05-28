<script lang="ts">
	type Props = { level?: number; xpInLevel?: number; xpToNext?: number };
	let { level = 0, xpInLevel = 0, xpToNext = 100 }: Props = $props();

	const pct = $derived(Math.min(100, Math.round((xpInLevel / xpToNext) * 100)));
</script>

<div>
	<div class="flex justify-between items-center mb-1">
		<span class="text-sm font-bold text-yellow-400">Level {level}</span>
		<span class="text-xs text-slate-400">{xpInLevel} / {xpToNext} XP</span>
	</div>
	<div class="bg-slate-700 rounded-full h-3 overflow-hidden">
		<div
			class="h-full bg-gradient-to-r from-yellow-400 to-yellow-300 rounded-full transition-all duration-500"
			style="width: {pct}%"
		></div>
	</div>
</div>
