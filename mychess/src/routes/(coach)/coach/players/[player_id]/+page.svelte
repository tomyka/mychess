<script lang="ts">
  import { enhance } from '$app/forms';
  import { m } from '$lib/paraglide/messages';
  import { resolveOpening, curatedOpeningName } from '$lib/openings/resolve';
  import { getLocale } from '$lib/paraglide/runtime';

  let { data, form } = $props<{ data: any; form: any }>();

  let assignModalOpen = $state(false);
  const playerName = $derived(data.player?.display_name ?? m.coach_player_fallback_name());

  const LEVEL_LABEL = {
    bronze: m.level_bronze,
    silver: m.level_silver,
    gold: m.level_gold,
    platinum: m.level_platinum
  } as const;

  const LEVEL_BADGE_CLASS = {
    bronze: 'border-[#B08D57]/40 bg-[#B08D57]/10 text-[#8a6b3f] dark:text-[#cda876]',
    silver: 'border-[#A8A8A8]/40 bg-[#A8A8A8]/10 text-[#6b6b6b] dark:text-[#c7c7c7]',
    gold: 'border-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8a6d10] dark:text-[#e0c15c]',
    platinum: 'border-[#E8B923]/40 bg-[#E8B923]/10 text-[#a4790f] dark:text-[#E8B923]'
  } as const;
</script>

<svelte:head>
  <title>{m.seo_coach_player_title({ name: playerName })}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <a href="/coach" class="text-(--color-muted) text-sm hover:text-gray-600 dark:hover:text-gray-400 block">{m.coach_back_to_dashboard_link()}</a>
    <h1 class="text-2xl font-bold text-(--color-text)">{playerName}</h1>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800 dark:text-red-400">{form.error}</p>
    {/if}

    <section class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-3">{m.coach_player_stats_heading()}</h2>
      <div class="grid grid-cols-2 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-(--color-text)">{data.stats?.total_reviews ?? 0}</p>
          <p class="text-xs text-(--color-muted)">{m.coach_player_stat_reviews()}</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-(--color-text)">{data.stats?.moves_learned ?? 0}</p>
          <p class="text-xs text-(--color-muted)">{m.coach_player_stat_moves_learned()}</p>
        </div>
      </div>
    </section>

    <section class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-(--color-text)">{m.coach_player_repertoires_heading()}</h2>
        {#if data.coachReps.length > 0}
          <button
            type="button"
            onclick={() => (assignModalOpen = true)}
            aria-label={m.coach_player_assign_reps_label()}
            title={m.coach_player_assign_reps_label()}
            class="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-indigo-50 text-(--color-accent) hover:bg-indigo-100 transition-colors font-bold dark:bg-indigo-950"
          >
            +
          </button>
        {/if}
      </div>

      {#if data.coachReps.length === 0}
        <p class="text-(--color-muted) text-sm mb-3">
          {m.coach_player_no_reps_prefix()}
          <a href="/coach/pgn" class="text-(--color-accent) hover:underline">{m.coach_player_no_reps_upload_link()}</a> {m.coach_player_no_reps_suffix()}
        </p>
      {/if}

      {#if data.assignedReps.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coach_player_no_assigned()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.assignedReps as a (a.id)}
            {@const opening = a.repertoire ? resolveOpening(a.repertoire) : null}
            {@const isActive = !!a.repertoire && (data.activeRepertoireIds ?? []).includes(a.repertoire.id)}
            <li class="flex items-center gap-3 bg-(--color-bg) rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0"
                    style="background:{a.repertoire?.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <span class="text-sm text-(--color-text)">{a.repertoire?.name}</span>
              {#if opening}
                <span class="text-xs text-(--color-muted)">{curatedOpeningName(opening, getLocale())}</span>
                {#if isActive}
                  <span
                    class="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]"
                    >{m.coach_player_opening_active()}</span
                  >
                {:else}
                  <form method="POST" action="?/setActive" use:enhance class="ml-auto">
                    <input type="hidden" name="rep_id" value={a.repertoire.id} />
                    <button type="submit" class="text-xs text-(--color-accent) hover:underline"
                      >{m.coach_player_opening_make_active()}</button
                    >
                  </form>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-(--color-text)">{m.coach_player_practice_report_heading()}</h2>
        <div class="flex gap-1 text-xs">
          <a href="?range=30d" aria-current={data.range === '30d' ? 'true' : undefined} class="px-2 py-1 rounded-full {data.range === '30d' ? 'bg-(--color-accent) text-white' : 'bg-gray-100 text-(--color-muted) dark:bg-gray-800'}">{m.coach_player_range_30d()}</a>
          <a href="?range=all" aria-current={data.range === 'all' ? 'true' : undefined} class="px-2 py-1 rounded-full {data.range === 'all' ? 'bg-(--color-accent) text-white' : 'bg-gray-100 text-(--color-muted) dark:bg-gray-800'}">{m.coach_player_range_all_time()}</a>
        </div>
      </div>

      {#if data.practiceReports.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coach_player_no_reps_assigned_yet()}</p>
      {:else}
        <div class="space-y-4">
          {#each data.practiceReports as pr (pr.repertoireId ?? pr.repertoireName)}
            <div class="bg-(--color-bg) rounded-lg p-4">
              <!-- Counted for THIS repertoire only — the roster on
                   /coach/reports sums the same-named figures across all of a
                   student's repertoires, so the two pages legitimately differ
                   and each now states its scope. -->
              <h3 class="font-medium text-(--color-text) text-sm mb-3">
                {pr.repertoireName}
                <span class="text-(--color-muted) font-normal"
                  >— {pr.total > 0 ? m.coach_player_progress_learned({ solved: pr.solved, total: pr.total }) : m.coach_player_progress_no_moves()}</span
                >
                {#if pr.total > 0}
                  <span
                    class="ml-1 align-middle text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border {pr.status ===
                    'learned'
                      ? 'border-[#6FCF73]/40 bg-[#6FCF73]/10 text-[#4b9e50] dark:text-[#6FCF73]'
                      : 'border-(--color-border) bg-(--color-bg) text-(--color-muted)'}"
                  >
                    {pr.status === 'learned' ? m.coach_player_status_learned() : m.coach_player_status_learning()}
                  </span>
                {/if}
                <span class="block text-xs text-(--color-muted) font-normal mt-0.5">{m.coach_player_scope_note()}</span>
              </h3>
              {#if pr.total > 0}
                <p class="text-xs text-(--color-muted) mb-2 flex items-center gap-1.5 flex-wrap">
                  <span>{m.coach_player_level_prefix()}</span>
                  <span
                    class="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border {LEVEL_BADGE_CLASS[pr.level as keyof typeof LEVEL_BADGE_CLASS] ?? 'border-(--color-border) bg-(--color-bg) text-(--color-muted)'}"
                  >
                    {LEVEL_LABEL[pr.level as keyof typeof LEVEL_LABEL]?.() ?? m.level_none()}
                  </span>
                  {#if pr.demotions > 0}
                    · <span class="text-amber-600 dark:text-amber-400"
                      >{m.coach_player_demotions({ count: pr.demotions })}</span
                    >
                  {/if}
                </p>
              {/if}

              {#if !pr.report || pr.report.accuracy.length === 0}
                <p class="text-(--color-muted) text-xs">{m.coach_player_no_activity()}</p>
              {:else}
                <div class="grid grid-cols-3 gap-2 text-center text-sm mb-3">
                  <div>
                    <p class="font-bold text-(--color-text)">{pr.report.activity.sessionCount}</p>
                    <p class="text-xs text-(--color-muted)">{m.coach_player_stat_sessions()}</p>
                  </div>
                  <div>
                    <p class="font-bold text-(--color-text)">{pr.report.activity.streakDays}</p>
                    <p class="text-xs text-(--color-muted)">{m.coach_player_stat_streak()}</p>
                  </div>
                  <div>
                    <p class="font-bold text-(--color-text)">
                      {pr.report.activity.lastPracticedAt ? new Date(pr.report.activity.lastPracticedAt).toLocaleDateString() : '—'}
                    </p>
                    <p class="text-xs text-(--color-muted)">{m.coach_player_stat_last_practiced()}</p>
                  </div>
                </div>

                <svg viewBox="0 0 {pr.report.accuracy.length * 14} 60" class="w-full h-16 mb-1" role="img"
                     aria-label={m.coach_player_accuracy_chart_aria({ name: pr.repertoireName })}>
                  {#each pr.report.accuracy as point, i (point.bucket)}
                    {@const total = point.correct + point.wrong}
                    {@const wrongH = total === 0 ? 0 : (point.wrong / total) * 46}
                    {@const correctH = total === 0 ? 0 : (point.correct / total) * 46}
                    {@const gap = wrongH > 0 && correctH > 0 ? 2 : 0}
                    <g transform="translate({i * 14}, 0)">
                      <title>{m.coach_player_accuracy_point_title({ bucket: point.bucket, correct: point.correct, total })}</title>
                      <rect x="2" y={56 - wrongH} width="10" height={wrongH} rx="2" fill="#f87171" />
                      <rect x="2" y={56 - wrongH - gap - correctH} width="10" height={correctH} rx="2" fill="#4ade80" />
                    </g>
                  {/each}
                </svg>
                <span class="sr-only">
                  {#each pr.report.accuracy as point (point.bucket)}
                    {m.coach_player_accuracy_point_sr({ bucket: point.bucket, correct: point.correct, total: point.correct + point.wrong })}
                  {/each}
                </span>
                <div class="flex gap-3 text-xs text-(--color-muted) mb-3">
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400"></span>{m.coach_player_legend_correct()}</span>
                  <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-400"></span>{m.coach_player_legend_wrong()}</span>
                </div>

                {#if pr.report.hotspots.length > 0}
                  <p class="text-xs font-medium text-(--color-muted) mb-1">{m.coach_player_hotspots_heading()}</p>
                  <ul class="text-xs text-(--color-text) space-y-0.5">
                    {#each pr.report.hotspots as h (h.moveId)}
                      <li>{m.coach_player_hotspot_line({ label: h.label, missCount: h.missCount, attemptCount: h.attemptCount })}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-(--color-text) mb-3">{m.coach_player_notes_heading()}</h2>
      <form method="POST" action="?/addNote" use:enhance class="flex gap-2 mb-4">
        <input name="note" placeholder={m.coach_player_note_placeholder()}
               class="flex-1 rounded-lg px-4 py-2.5 border border-(--color-border) text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button class="bg-(--color-accent) text-white px-4 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          {m.coach_player_add_note_button()}
        </button>
      </form>
      {#if data.notes.length === 0}
        <p class="text-(--color-muted) text-sm">{m.coach_player_no_notes()}</p>
      {:else}
        <ul class="space-y-2">
          {#each data.notes as note (note.id)}
            <li class="bg-(--color-bg) rounded-lg p-3">
              <p class="text-sm text-(--color-text)">{note.note}</p>
              <p class="text-xs text-(--color-muted) mt-1">{new Date(note.created_at).toLocaleDateString()}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</main>

{#if assignModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
    onclick={() => (assignModalOpen = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-(--color-surface) rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 class="font-semibold text-(--color-text) truncate">{m.coach_player_modal_heading({ name: playerName })}</h2>
        <button
          type="button"
          onclick={() => (assignModalOpen = false)}
          aria-label={m.coach_player_modal_close_label()}
          class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div class="p-4">
        <ul class="space-y-2">
          {#each data.coachReps as rep (rep.id)}
            {@const isAssigned = data.assignedReps.some((a: any) => a.repertoire?.id === rep.id)}
            <li class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
                <span class="text-sm text-(--color-text) truncate">{rep.name}</span>
              </span>
              {#if isAssigned}
                <form method="POST" action="?/unassignRep" use:enhance>
                  <input type="hidden" name="rep_id" value={rep.id} />
                  <button class="text-sm text-red-600 hover:underline shrink-0 dark:text-red-400">{m.coach_player_unassign_button()}</button>
                </form>
              {:else}
                <form method="POST" action="?/assignRep" use:enhance>
                  <input type="hidden" name="rep_id" value={rep.id} />
                  <button class="text-sm bg-(--color-accent) text-white px-3 py-1 rounded-lg hover:bg-(--color-accent-hover) transition-colors shrink-0">
                    {m.coach_player_assign_button()}
                  </button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{/if}
