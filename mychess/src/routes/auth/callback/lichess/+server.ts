import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import { verifyState } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ url, cookies, locals: { safeGetSession } }) => {
  const { LICHESS_CLIENT_ID, OAUTH_STATE_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  const redirectUri = `${url.origin}/auth/callback/lichess`;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    throw redirect(303, '/settings?oauth_error=Lichess+authentication+was+denied+or+failed');
  }

  const verifier = cookies.get('oauth_pkce_verifier_lichess');
  cookies.delete('oauth_pkce_verifier_lichess', { path: '/' });

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

  const tokenRes = await fetch('https://lichess.org/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: LICHESS_CLIENT_ID
    })
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => 'unreadable');
    throw redirect(
      303,
      `/settings?oauth_error=${encodeURIComponent(`Lichess token exchange failed (${tokenRes.status}): ${errBody}`)}`
    );
  }

  const tokenData = await tokenRes.json();
  const accessToken: string | undefined = tokenData.access_token;

  if (!accessToken) {
    throw redirect(303, '/settings?oauth_error=Failed+to+exchange+Lichess+token');
  }

  const accountRes = await fetch('https://lichess.org/api/account', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!accountRes.ok) {
    throw redirect(303, '/settings?oauth_error=Failed+to+fetch+Lichess+profile');
  }

  const account = await accountRes.json();
  const username: string | undefined = account.username;

  if (!username) {
    throw redirect(303, '/settings?oauth_error=Could+not+read+Lichess+username');
  }

  // Use service role client to bypass RLS — identity already verified above
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error: dbError } = await admin
    .from('profiles')
    .update({ lichess_username: username })
    .eq('id', userId);

  if (dbError) {
    throw redirect(
      303,
      `/settings?oauth_error=${encodeURIComponent(`DB update error: ${dbError.message} (code: ${dbError.code})`)}`
    );
  }

  // Verify the write actually persisted
  const { data: verify, error: verifyErr } = await admin
    .from('profiles')
    .select('lichess_username')
    .eq('id', userId)
    .single();

  const saved = (verify as any)?.lichess_username;
  if (saved !== username) {
    throw redirect(
      303,
      `/settings?oauth_error=${encodeURIComponent(`Write verification failed: DB has "${saved}", expected "${username}". verifyErr: ${verifyErr?.message ?? 'none'}. userId: ${userId}`)}`
    );
  }

  throw redirect(303, `/settings?oauth_success=Lichess+account+${encodeURIComponent(username)}+connected`);
};
