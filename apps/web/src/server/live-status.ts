import type { CoachStatus } from '@mychess/db';

/**
 * A live assignment's deadline and status: what the shared status line
 * shows (#401). A fork has no deadline or done of its own (R-155), so
 * there is no forked flag: a row that is a fork has no live status.
 */
export type LiveStatus = Omit<CoachStatus, 'forked'>;
