import { z } from 'zod';

/**
 * An account id from a form field or a route segment: a coach's or a
 * player's. Ids are opaque text (better-auth), so only the length is held.
 */
export const accountIdSchema = z.string().min(1).max(100);
