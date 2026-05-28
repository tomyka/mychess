<script lang="ts">
	let { data } = $props<{ data: any }>();

	const profile = $derived(data.profile as any);
	const stats = $derived((data as any).stats ?? {});
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">
	<div class="flex items-center gap-4 mb-8">
		<div class="w-16 h-16 bg-yellow-400 rounded-2xl flex items-center justify-center text-3xl shadow-lg">
			♞
		</div>
		<div>
			<h1 class="text-2xl font-bold">{profile?.display_name ?? 'Player'}</h1>
			<div class="flex items-center gap-2">
				<span class="text-yellow-400 font-bold">Lv {stats.level ?? 0}</span>
				<span class="text-slate-400 text-sm">· {stats.total_xp ?? 0} XP</span>
			</div>
		</div>
	</div>

	<!-- XP Bar -->
	<div class="bg-slate-800 rounded-full h-3 mb-2 overflow-hidden">
		<div
			class="h-full bg-yellow-400 rounded-full transition-all"
			style="width: {Math.min(100, ((stats.xp_in_level ?? 0) / (stats.xp_to_next ?? 100)) * 100)}%"
		></div>
	</div>
	<p class="text-xs text-slate-400 mb-8">{stats.xp_in_level ?? 0} / {stats.xp_to_next ?? 100} XP to next level</p>

	<!-- Streak -->
	<div class="bg-slate-800 rounded-2xl p-5 mb-4 flex items-center gap-4">
		<span class="text-4xl">🔥</span>
		<div>
			<p class="font-bold text-xl">{stats.streak_days ?? 0} day streak</p>
			<p class="text-slate-400 text-sm">Keep it up! Train daily to grow your streak.</p>
		</div>
	</div>

	<!-- Quick actions -->
	<div class="grid grid-cols-2 gap-3 mt-4">
		<a href="/repertoires" class="bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition text-center">
			<p class="text-3xl mb-2">📚</p>
			<p class="font-semibold">Repertoires</p>
		</a>
		<a href="/learn" class="bg-yellow-400 text-slate-900 rounded-2xl p-5 hover:bg-yellow-300 transition text-center">
			<p class="text-3xl mb-2">🎯</p>
			<p class="font-bold">Daily Training</p>
		</a>
	</div>
</main>
