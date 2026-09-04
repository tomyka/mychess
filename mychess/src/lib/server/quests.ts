// mychess/src/lib/server/quests.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectDailyQuests } from '$lib/quests/generate';

/**
 * Shape of a `public.quests` row (see migration 0005_phase_b.sql). The column
 * names here must match the live table exactly — a mismatch makes every read
 * and write fail, which is how the daily-quest panel silently stayed empty for
 * a long time. `completed_at` is a nullable timestamp, not a boolean flag.
 */
export type QuestRow = {
  id: string;
  player_id: string;
  date: string;
  template_id: string;
  description: string;
  target: number;
  progress: number;
  completed_at: string | null;
};

/**
 * Loads today's quests for a player, seeding them from the daily templates on first load.
 *
 * Errors are logged rather than thrown: this runs inside the home page's
 * `Promise.all` (`src/routes/(player)/+page.server.ts`), so throwing would turn
 * a failed gamification query into a 500 for the whole dashboard. An empty
 * quest panel is an acceptable degradation; a dead home page is not. The
 * logging is the part that matters — a failure can no longer look like
 * "this player just has no quests today".
 */
export async function ensureDailyQuests(
  supabase: SupabaseClient,
  playerId: string,
  date: string
): Promise<QuestRow[]> {
  const { data: existing, error: readError } = await supabase
    .from('quests')
    .select('*')
    .eq('player_id', playerId)
    .eq('date', date);

  if (readError) {
    console.error(
      `ensureDailyQuests: failed to read quests for player ${playerId} on ${date}:`,
      readError.message,
      readError
    );
    // Don't try to seed on top of an unknown state — a blind insert here would
    // either duplicate today's quests or trip the unique(player_id, date,
    // template_id) constraint and add a second, more confusing error.
    return [];
  }

  if (existing && existing.length > 0) return existing as QuestRow[];

  const templates = selectDailyQuests(date, playerId);
  // `completed_at` is intentionally omitted: the column is nullable with no
  // default, so a fresh (incomplete) quest is simply NULL.
  const rows = templates.map((t) => ({
    player_id: playerId,
    date,
    template_id: t.id,
    description: t.description,
    target: t.target,
    progress: 0
  }));

  const { data: inserted, error: insertError } = await supabase.from('quests').insert(rows).select();

  if (insertError) {
    console.error(
      `ensureDailyQuests: failed to seed ${rows.length} quest(s) for player ${playerId} on ${date}:`,
      insertError.message,
      insertError
    );
    return [];
  }

  return (inserted ?? []) as QuestRow[];
}

/**
 * Adds `amount` to today's progress on `questId` (a quest *template* id, stored
 * as `quests.template_id`), capped at target. No-op if the quest doesn't exist
 * today or is already completed.
 *
 * Unlike `ensureDailyQuests`, real DB errors are thrown: this is a write, the
 * caller (`/api/practice/attempt`) already
 * await it, and a swallowed failure here means progress is lost with nothing to
 * show for it. "No quest row for today" (PGRST116) is a legitimate no-op and
 * stays quiet.
 */
export async function incrementQuestProgress(
  supabase: SupabaseClient,
  playerId: string,
  questId: string,
  date: string,
  amount = 1
): Promise<void> {
  const { data: quest, error: readError } = await supabase
    .from('quests')
    .select('id, progress, target, completed_at')
    .eq('player_id', playerId)
    .eq('date', date)
    .eq('template_id', questId)
    .maybeSingle();

  if (readError) {
    throw new Error(
      `incrementQuestProgress: failed to read quest "${questId}" for player ${playerId} on ${date}: ${readError.message}`
    );
  }

  if (!quest || quest.completed_at !== null) return;

  const newProgress = Math.min(quest.progress + amount, quest.target);
  const nowComplete = newProgress >= quest.target;

  const { error: updateError } = await supabase
    .from('quests')
    .update({
      progress: newProgress,
      completed_at: nowComplete ? new Date().toISOString() : null
    })
    .eq('id', quest.id);

  if (updateError) {
    throw new Error(
      `incrementQuestProgress: failed to update quest "${questId}" (row ${quest.id}) for player ${playerId}: ${updateError.message}`
    );
  }
}
