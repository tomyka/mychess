import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  CHESSCOM_CLIENT_ID,
  CHESSCOM_CLIENT_SECRET,
  CHESSCOM_REDIRECT_URI,
  OAUTH_STATE_SECRET
} from '$env/static/private';
import { verifyState } from '$lib/server/oauth';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid JWT structure');
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(padded));
}

export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    throw redirect(303, '/settings?oauth_error=Chess.com+authentication+was+denied+or+failed');
  }

  const verifier = cookies.get('oauth_pkce_verifier');
  cookies.delete('oauth_pkce_verifier', { path: '/' });

  if (!verifier) {
    throw redirect(303, '/settings?oauth_error=OAuth+session+expired.+Please+try+again');
  }

  let userId: string;
  try {
    userId = await verifyState(state, OAUTH_STATE_SECRET);
  } catch {
    throw redirect(303, '/settings?oauth_error=Invalid+OAuth+state.+Please+try+again');
  }

  const tokenRes = await fetch('https://oauth.chess.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: CHESSCOM_REDIRECT_URI,
      client_id: CHESSCOM_CLIENT_ID,
      client_secret: CHESSCOM_CLIENT_SECRET
    })
  });

  if (!tokenRes.ok) {
    throw redirect(303, '/settings?oauth_error=Failed+to+exchange+Chess.com+token');
  }

  const tokenData = await tokenRes.json();

  let username: string | undefined;
  if (tokenData.id_token) {
    try {
      const claims = decodeJwtPayload(tokenData.id_token);
      username = claims.preferred_username as string | undefined;
    } catch {
      // fall through to error below
    }
  }

  if (!username) {
    throw redirect(303, '/settings?oauth_error=Could+not+read+Chess.com+username+from+token');
  }

  const { error: dbError } = await supabase
    .from('profiles')
    .update({ chesscom_username: username } as any)
    .eq('id', userId);

  if (dbError) {
    throw redirect(303, '/settings?oauth_error=Failed+to+save+Chess.com+username');
  }

  throw redirect(303, `/settings?oauth_success=Chess.com+account+${encodeURIComponent(username)}+connected`);
};
