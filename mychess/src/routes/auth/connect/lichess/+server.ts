import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
const { LICHESS_CLIENT_ID, LICHESS_REDIRECT_URI, OAUTH_STATE_SECRET } = env;
import { generateCodeVerifier, generateCodeChallenge, createState } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ locals: { safeGetSession }, cookies }) => {
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
    redirect_uri: LICHESS_REDIRECT_URI,
    scope: 'preference:read',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state
  });

  throw redirect(303, `https://lichess.org/oauth?${params}`);
};
