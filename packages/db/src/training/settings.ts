/**
 * A player's two training limits (R-62, R-146), stored on their account
 * (S6 decision 8). The acting player is always the session account.
 */
import {
  DEFAULT_TRAINING_SETTINGS,
  trainingSettingsSchema,
  type TrainingSettings,
} from '@mychess/domain';
import { eq } from 'drizzle-orm';
import type { Executor } from '../client';
import { accounts } from '../schema';

/** The player's limits; the defaults for an account that does not exist. */
export async function trainingSettings(
  db: Executor,
  playerId: string,
): Promise<TrainingSettings> {
  const [row] = await db
    .select({
      sessionSize: accounts.sessionSize,
      newPerDay: accounts.newPerDay,
    })
    .from(accounts)
    .where(eq(accounts.id, playerId));
  return row === undefined
    ? DEFAULT_TRAINING_SETTINGS
    : trainingSettingsSchema.parse(row);
}

/** Stores the player's limits, already parsed with trainingSettingsSchema. */
export async function setTrainingSettings(
  db: Executor,
  playerId: string,
  settings: TrainingSettings,
  now: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({
      sessionSize: settings.sessionSize,
      newPerDay: settings.newPerDay,
      updatedAt: now,
    })
    .where(eq(accounts.id, playerId));
}
