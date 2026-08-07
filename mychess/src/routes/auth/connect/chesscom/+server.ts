import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { generateCodeVerifier, generateCodeChallenge, createState } from '$lib/server/oauth';
import { requireEnv } from '$lib/env';

export const GET: RequestHandler = async ({ url, locals: { safeGetSession }, cookies }) => {
  const CHESSCOM_CLIENT_ID = requireEnv(env.CHESSCOM_CLIENT_ID, 'CHESSCOM_CLIENT_ID');
  const OAUTH_STATE_SECRET = requireEnv(env.OAUTH_STATE_SECRET, 'OAUTH_STATE_SECRET');
  const redirectUri = `${url.origin}/auth/callback/chesscom`;
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = await createState(user.id, OAUTH_STATE_SECRET);

  cookies.set('oauth_pkce_verifier_chesscom', verifier, {
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax',
    maxAge: 300,
    path: '/'
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CHESSCOM_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state
  });

  throw redirect(303, `https://oauth.chess.com/authorize?${params}`);
};
