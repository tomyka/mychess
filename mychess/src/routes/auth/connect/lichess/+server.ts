import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { generateCodeVerifier, generateCodeChallenge, createState } from '$lib/server/oauth';
import { requireEnv } from '$lib/env';

export const GET: RequestHandler = async ({ url, locals: { safeGetSession }, cookies }) => {
  const LICHESS_CLIENT_ID = requireEnv(env.LICHESS_CLIENT_ID, 'LICHESS_CLIENT_ID');
  const OAUTH_STATE_SECRET = requireEnv(env.OAUTH_STATE_SECRET, 'OAUTH_STATE_SECRET');
  const redirectUri = `${url.origin}/auth/callback/lichess`;
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = await createState(user.id, OAUTH_STATE_SECRET);

  cookies.set('oauth_pkce_verifier_lichess', verifier, {
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: 300,
    path: '/'
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LICHESS_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'preference:read',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state
  });

  throw redirect(303, `https://lichess.org/oauth?${params}`);
};
