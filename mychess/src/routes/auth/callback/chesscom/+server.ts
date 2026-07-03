import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import { verifyState, decodeJwtPayload } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ url, cookies, locals: { safeGetSession } }) => {
  const { CHESSCOM_CLIENT_ID, CHESSCOM_CLIENT_SECRET, OAUTH_STATE_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  const redirectUri = `${url.origin}/auth/callback/chesscom`;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    throw redirect(303, '/settings?oauth_error=Chess.com+authentication+was+denied+or+failed');
  }

  const verifier = cookies.get('oauth_pkce_verifier_chesscom');
  cookies.delete('oauth_pkce_verifier_chesscom', { path: '/' });

  if (!verifier) {
    throw redirect(303, '/settings?oauth_error=OAuth+session+expired.+Please+try+again');
  }

  let userId: string;
  try {
    userId = await verifyState(state, OAUTH_STATE_SECRET);
  } catch {
    throw redirect(303, '/settings?oauth_error=Invalid+OAuth+state.+Please+try+again');
  }

  const { user: sessionUser } = await safeGetSession();
  if (!sessionUser || sessionUser.id !== userId) {
    throw redirect(303, '/settings?oauth_error=Session+expired.+Please+log+in+and+try+again');
  }

  const tokenRes = await fetch('https://oauth.chess.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
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

  // Use service role client to bypass RLS — identity already verified above
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: dbError } = await admin
    .from('profiles')
    .update({ chesscom_username: username })
    .eq('id', userId);

  if (dbError) {
    throw redirect(
      303,
      `/settings?oauth_error=${encodeURIComponent(`Failed to save Chess.com username: ${dbError.message}`)}`
    );
  }

  throw redirect(303, `/settings?oauth_success=Chess.com+account+${encodeURIComponent(username)}+connected`);
};
