/**
 * A player's training settings (R-62, R-146, R-205), stored on their account
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

/** The player's settings; the defaults for an account that does not exist. */
export async function trainingSettings(
  db: Executor,
  playerId: string,
): Promise<TrainingSettings> {
  const [row] = await db
    .select({
      sessionSize: accounts.sessionSize,
      newPerDay: accounts.newPerDay,
      learnArrows: accounts.learnArrows,
    })
    .from(accounts)
    .where(eq(accounts.id, playerId));
  return row === undefined
    ? DEFAULT_TRAINING_SETTINGS
    : trainingSettingsSchema.parse(row);
}

/** Stores the player's settings, already parsed with trainingSettingsSchema. */
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
      learnArrows: settings.learnArrows,
      updatedAt: now,
    })
    .where(eq(accounts.id, playerId));
}
