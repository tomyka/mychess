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

/** The SQL text of a `query` call's first argument: a string or a query config. */
const textOf = (arg: unknown): string =>
  typeof arg === 'object' && arg !== null && 'text' in arg
    ? String(arg.text)
    : String(arg);

/** The SQL text of each statement `run` sends, in order, BEGIN and COMMIT included. */
export async function statementsOf(
  run: () => Promise<unknown>,
): Promise<string[]> {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  try {
    await run();
    return spy.mock.calls.map((call) => textOf(call[0]));
  } finally {
    spy.mockRestore();
  }
}
