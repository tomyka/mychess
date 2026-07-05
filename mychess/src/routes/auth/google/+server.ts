import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { generateCodeVerifier, generateCodeChallenge, createState } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const { GOOGLE_CLIENT_ID, OAUTH_STATE_SECRET } = env;
  const redirectUri = `${url.origin}/auth/callback/google`;
  const persist = url.searchParams.get('persist') !== '0';

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // No logged-in user yet for a fresh sign-in — pass a random correlator.
  // verifyState only checks the HMAC signature and expiry here, not identity.
  const state = await createState(crypto.randomUUID(), OAUTH_STATE_SECRET);

  // OIDC nonce: raw value stored for later, its hash sent to Google. Google
  // embeds whatever it receives into the ID token's `nonce` claim; Supabase's
  // signInWithIdToken is given the raw value and re-hashes it to compare.
  const nonce = generateCodeVerifier();
  const hashedNonce = await generateCodeChallenge(nonce);

  const cookieOptions = {
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax' as const,
    maxAge: 300,
    path: '/'
  };
  cookies.set('oauth_pkce_verifier_google', verifier, cookieOptions);
  cookies.set('oauth_nonce_google', nonce, cookieOptions);

  if (persist) {
    cookies.delete('sb-no-persist', { path: '/' });
  } else {
    cookies.set('sb-no-persist', '1', { path: '/' });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    nonce: hashedNonce
  });

  throw redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
