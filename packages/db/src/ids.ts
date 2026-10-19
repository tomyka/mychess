// Row ids as the repositories receive them. Internal to the package.
import { z } from 'zod';

const uuidSchema = z.uuid();

/**
 * Could `id` name a row keyed by a uuid? Ids reach the repositories from
 * forms and URLs; a malformed one names nothing, and Postgres would fail
 * on it rather than find no row.
 */
export function isUuid(id: string): boolean {
  return uuidSchema.safeParse(id).success;
}
