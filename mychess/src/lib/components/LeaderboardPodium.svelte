<script lang="ts">
  export interface LeaderboardEntry {
    rank: number;
    kid_name: string;
    weekly_xp: number;
    avatar_id?: string;
    is_current_user: boolean;
  }

  type Props = { entries: LeaderboardEntry[] };
  let { entries }: Props = $props();

  const AVATAR_EMOJI: Record<string, string> = {
    knight: '♞', queen: '♛', king: '♚', rook: '♜', bishop: '♝', pawn: '♟'
  };

  const MEDALS = ['🥇', '🥈', '🥉'];
</script>

<div class="bg-white rounded-2xl shadow overflow-hidden">
  <div class="bg-amber-500 px-4 py-3">
    <h3 class="font-bold text-white text-base">🏆 This Week's Top Players</h3>
  </div>

  {#if entries.length === 0}
    <p class="text-center text-gray-400 py-6 text-sm">No activity yet this week!</p>
  {:else}
    <ul class="divide-y divide-gray-100">
      {#each entries as entry}
        <li
          class="flex items-center gap-3 px-4 py-3 transition-colors
                 {entry.is_current_user ? 'bg-amber-50' : 'hover:bg-gray-50'}"
        >
          <span class="w-7 text-xl text-center font-bold">
            {entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}
          </span>
          <span class="text-xl">{AVATAR_EMOJI[entry.avatar_id ?? 'knight'] ?? '♞'}</span>
          <span class="flex-1 font-medium text-gray-800 {entry.is_current_user ? 'text-amber-700' : ''}">
            {entry.kid_name}{entry.is_current_user ? ' (you)' : ''}
          </span>
          <span class="text-sm font-bold text-amber-600">{entry.weekly_xp} XP</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
