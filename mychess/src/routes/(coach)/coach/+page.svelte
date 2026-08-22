<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  let { data } = $props<{ data: any }>();
  const profile = $derived(data.profile as any);
  const players = $derived<any[]>(data.players ?? []);
  const pendingCount = $derived(data.pendingCount ?? 0);
</script>

<svelte:head>
  <title>{m.seo_coach_dashboard_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-(--color-text)">{m.coach_dashboard_heading()}</h1>
        <p class="text-(--color-muted) text-sm">{m.coach_dashboard_welcome({ name: profile?.display_name ?? m.coach_dashboard_coach_fallback_name() })}</p>
      </div>
      <a href="/coach/invite"
         class="bg-(--color-accent) text-white px-5 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
        {m.coach_dashboard_invite_player_button()}
      </a>
    </div>

    {#if pendingCount > 0}
      <a href="/coach/students"
         class="block mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 transition-colors dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400">
        {m.coach_dashboard_pending_students_banner({ count: pendingCount })}
      </a>
    {/if}

    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/students"
         class="bg-(--color-surface) border border-(--color-border) rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">👥</p>
        <p class="font-semibold text-(--color-text)">{m.coach_dashboard_find_players_heading()}</p>
        <p class="text-sm text-(--color-muted)">{m.coach_dashboard_find_players_subtitle()}</p>
      </a>
      <a href="/coach/invite"
         class="bg-(--color-surface) border border-(--color-border) rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-(--color-text)">{m.coach_dashboard_invite_links_heading()}</p>
        <p class="text-sm text-(--color-muted)">{m.coach_dashboard_invite_links_subtitle()}</p>
      </a>
      <a href="/coach/reports"
         class="bg-(--color-surface) border border-(--color-border) rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">📊</p>
        <p class="font-semibold text-(--color-text)">{m.coach_dashboard_reports_heading()}</p>
        <p class="text-sm text-(--color-muted)">{m.coach_dashboard_reports_subtitle()}</p>
      </a>
    </div>

    {#if players.length > 0}
      <section class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5">
        <h2 class="font-semibold text-(--color-text) mb-4">{m.coach_dashboard_your_players_heading({ count: players.length })}</h2>
        <ul class="space-y-1">
          {#each players as player (player.id)}
            <li>
              <a href="/coach/players/{player.id}"
                 class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center dark:bg-indigo-950 dark:text-indigo-300">
                  {(player.display_name ?? 'P')[0].toUpperCase()}
                </div>
                <span class="font-medium text-(--color-text)">{player.display_name}</span>
                <span class="ml-auto text-(--color-muted) text-sm">→</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <div class="bg-(--color-surface) border border-(--color-border) rounded-xl p-8 text-center text-(--color-muted)">
        <p class="text-4xl mb-3">👤</p>
        <p class="font-medium text-(--color-muted)">{m.coach_dashboard_no_players_heading()}</p>
        <p class="text-sm mt-1">{m.coach_dashboard_no_players_subtitle()}</p>
      </div>
    {/if}
  </div>
</main>
