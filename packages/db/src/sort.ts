import { byName } from '@mychess/domain';

/** An account as name lists show it. */
interface DisplayNamed {
  readonly id: string;
  readonly displayName: string;
}

/** Accounts (players, coaches, members) in the name lists' order (R-160). */
export const byDisplayName = byName((one: DisplayNamed) => ({
  name: one.displayName,
  id: one.id,
}));
