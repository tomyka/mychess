import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import { verifyState, decodeJwtPayload } from '$lib/server/oauth';
import { fullNameOrNull } from '$lib/profile';
import { createPlayerProfile } from '$lib/server/onboarding';

export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_STATE_SECRET, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { PUBLIC_SUPABASE_URL } = pubEnv;
  const redirectUri = `${url.origin}/auth/callback/google`;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    throw redirect(303, '/login?error=Google+sign-in+was+denied+or+failed');
  }

  const verifier = cookies.get('oauth_pkce_verifier_google');
  const nonce = cookies.get('oauth_nonce_google');
  cookies.delete('oauth_pkce_verifier_google', { path: '/' });
  cookies.delete('oauth_nonce_google', { path: '/' });

  if (!verifier || !nonce) {
    throw redirect(303, '/login?error=Sign-in+session+expired.+Please+try+again');
  }

  try {
    await verifyState(state, OAUTH_STATE_SECRET);
  } catch {
    throw redirect(303, '/login?error=Invalid+sign-in+state.+Please+try+again');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET
    })
  });

  if (!tokenRes.ok) {
    throw redirect(303, '/login?error=Failed+to+exchange+Google+token');
  }

  const tokenData = await tokenRes.json();
  const idToken: string | undefined = tokenData.id_token;

  if (!idToken) {
    throw redirect(303, '/login?error=Google+did+not+return+an+ID+token');
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce
  });

  if (signInError) {
    throw redirect(303, `/login?error=${encodeURIComponent(signInError.message)}`);
  }

  const userId = signInData.user?.id;

  if (userId) {
    try {
      // Use service role client to bypass RLS — identity already verified above
      const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: existingProfile } = await admin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (!existingProfile) {
        const claims = decodeJwtPayload(idToken);
        const firstName = (claims.given_name as string | undefined) ?? null;
        const lastName = (claims.family_name as string | undefined) ?? null;
        const displayName =
          fullNameOrNull(firstName, lastName) ?? (claims.name as string | undefined) ?? 'Player';

        await createPlayerProfile(admin, { id: userId, firstName, lastName, displayName });
      }
    } catch {
      // Best-effort bootstrap — any failure here is not fatal. The user is
      // already signed in, and the (player)/+layout.server.ts "no profile ->
      // /welcome" check acts as a safety net if profile creation didn't happen.
    }
  }

  throw redirect(303, '/');
};
