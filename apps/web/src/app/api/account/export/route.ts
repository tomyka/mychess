import { exportAccount } from '@mychess/db';
import { getDb } from '../../../../server/db';
import { getAccount } from '../../../../server/session';

// Personal data: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

/** The signed-in account's own data as a JSON download (R-40, security item 9). */
export async function GET(): Promise<Response> {
  const account = await getAccount();
  const data =
    account === null ? undefined : await exportAccount(getDb(), account.id);
  if (data === undefined)
    return new Response(null, { status: 401, headers: NO_STORE });
  return Response.json(data, {
    headers: {
      ...NO_STORE,
      'content-disposition': 'attachment; filename="mychess-export.json"',
    },
  });
}
