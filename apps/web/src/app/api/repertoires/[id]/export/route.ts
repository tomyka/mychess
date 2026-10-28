import { exportPgn } from '@mychess/chess';
import { plainChapterTitleIn } from '../../../../../server/chapter-names';
import { contentDisposition } from '../../../../../server/pgn-download';
import { ownRepertoire } from '../../../../../server/repertoires';
import { getAccount } from '../../../../../server/session';

// The owner's own work: never kept by a browser or proxy cache.
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * One repertoire as PGN (R-96), its chapters titled in the account's
 * language (decision 14). The owner only: a foreign, missing or malformed
 * id is the same empty 404 (decision 12). No fresh sign-in is asked for
 * (decision 13): R-95 is about the whole data export.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const account = await getAccount();
  if (account === null)
    return new Response(null, { status: 401, headers: NO_STORE });
  const own = await ownRepertoire(account, (await params).id, 'view');
  if (!own.ok) return new Response(null, { status: 404, headers: NO_STORE });
  const pgn = exportPgn(own.value.graph, {
    title: plainChapterTitleIn(account.locale),
  });
  return new Response(pgn, {
    headers: {
      ...NO_STORE,
      'content-type': 'application/x-chess-pgn; charset=utf-8',
      'content-disposition': contentDisposition(
        own.value.repertoire.name,
        account.locale,
      ),
    },
  });
}
