import { exportAccount } from '@mychess/db';
import { getDb } from '../../../../server/db';
import { SESSION_NOT_FRESH } from '../../../../lib/sign-in-errors';
import { getAccount, hasFreshSession } from '../../../../server/session';

// Personal data: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

const unauthorized = (): Response =>
  new Response(null, { status: 401, headers: NO_STORE });

/**
 * The signed-in account's own data as a JSON download (R-40, security item
 * 9), with its active sessions (R-89), for a session signed in within the
 * last day (R-95): a stolen old session cannot take the data away.
 */
export async function GET(): Promise<Response> {
  const account = await getAccount();
  if (account === null) return unauthorized();
  if (!(await hasFreshSession()))
    return Response.json(
      { code: SESSION_NOT_FRESH },
      { status: 403, headers: NO_STORE },
    );
  const data = await exportAccount(getDb(), account.id, new Date());
  if (data === undefined) return unauthorized();
  return Response.json(data, {
    headers: {
      ...NO_STORE,
      'content-disposition': 'attachment; filename="mychess-export.json"',
    },
  });
}
