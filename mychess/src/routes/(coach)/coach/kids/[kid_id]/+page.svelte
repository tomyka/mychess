<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();
  const d = $derived(data);
</script>

<main class="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
  <a href="/coach" class="text-slate-400 text-sm mb-6 block">← Back to Dashboard</a>

  <!-- Kid Header -->
  <div class="flex items-center gap-4 mb-6">
    <div class="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center text-2xl">♞</div>
    <div>
      <h1 class="text-2xl font-bold">{d.kid?.display_name}</h1>
      <p class="text-slate-400 text-sm">Level {d.stats?.level ?? 0} · {d.stats?.total_xp ?? 0} XP · {d.stats?.streak_days ?? 0}🔥</p>
    </div>
  </div>

  <!-- XP Bar -->
  <div class="bg-slate-700 rounded-full h-2 mb-6 overflow-hidden">
    <div class="h-full bg-yellow-400 transition-all"
         style="width: {Math.min(100, ((d.stats?.xpInLevel ?? 0) / (d.stats?.xpToNextLevel ?? 100)) * 100)}%">
    </div>
  </div>

  <!-- Repertoires -->
  <section class="mb-6">
    <h2 class="text-lg font-bold mb-3">Repertoires ({d.repertoires.length})</h2>
    {#if d.repertoires.length === 0}
      <p class="text-slate-400 text-sm mb-3">No repertoires yet.</p>
    {:else}
      <ul class="space-y-2 mb-3">
        {#each d.repertoires as rep}
          <li class="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
            <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#facc15'}"></span>
            <span class="font-medium">{rep.name}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <a href="/coach/pgn?kid={d.kid?.id}"
       class="block w-full text-center bg-yellow-400 text-slate-900 py-3 rounded-xl font-bold hover:bg-yellow-300 transition text-sm">
      + Upload Repertoire
    </a>
  </section>

  <!-- Assign Coach Repertoire -->
  {#if d.coachReps.length > 0}
    <section class="bg-slate-800 rounded-2xl p-4 mb-6">
      <h2 class="font-bold mb-3">📋 Assign Repertoire</h2>
      <form method="POST" action="?/assignRep" use:enhance>
        <select name="rep_id" class="w-full bg-slate-700 rounded-lg px-3 py-2 mb-3 text-sm">
          {#each d.coachReps as rep}
            <option value={rep.id}>{rep.name}</option>
          {/each}
        </select>
        <button class="w-full bg-blue-500 py-2 rounded-lg font-bold hover:bg-blue-400 transition text-sm">
          Assign
        </button>
      </form>
    </section>
  {/if}

  <!-- Weekly XP Goal -->
  <section class="bg-slate-800 rounded-2xl p-4 mb-6">
    <h2 class="font-bold mb-1">🎯 Weekly XP Goal</h2>
    <p class="text-slate-400 text-xs mb-3">Current: {d.kid?.weekly_xp_goal ?? 200} XP/week</p>
    <form method="POST" action="?/setGoal" use:enhance class="flex gap-2">
      <input type="number" name="weekly_xp_goal" min="0" max="5000" step="50"
             value={d.kid?.weekly_xp_goal ?? 200}
             class="flex-1 bg-slate-700 rounded-lg px-3 py-2 text-sm" />
      <button class="bg-yellow-400 text-slate-900 px-4 py-2 rounded-lg font-bold hover:bg-yellow-300 transition text-sm">
        Set
      </button>
    </form>
    {#if form?.success}
      <p class="text-green-400 text-xs mt-2">✅ Saved!</p>
    {/if}
  </section>

  <!-- Coach Notes -->
  <section class="bg-slate-800 rounded-2xl p-4 mb-4">
    <h2 class="font-bold mb-3">📝 Coach Notes</h2>
    {#if d.notes.length > 0}
      <ul class="space-y-2 mb-4">
        {#each d.notes as note}
          <li class="bg-slate-700 rounded-lg p-3 text-sm">
            <p class="text-white">{note.message}</p>
            <p class="text-slate-400 text-xs mt-1">
              {new Date(note.created_at).toLocaleDateString()}
              {note.read_at ? '· ✅ Read' : '· Unread'}
            </p>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-slate-400 text-sm mb-3">No notes yet.</p>
    {/if}
    <form method="POST" action="?/addNote" use:enhance>
      <textarea name="message" rows="2" placeholder="Write a note for {d.kid?.display_name}..."
                class="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm mb-2 resize-none"></textarea>
      <button class="w-full bg-green-500 py-2 rounded-lg font-bold hover:bg-green-400 transition text-sm">
        Send Note
      </button>
    </form>
  </section>
</main>
