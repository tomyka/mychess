import pg from 'pg';
import { vi } from 'vitest';

/** How many statements `run` sends, BEGIN and COMMIT included. */
export async function countStatements(
  run: () => Promise<unknown>,
): Promise<number> {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}
