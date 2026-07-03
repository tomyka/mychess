import { createSupabaseClient } from '$lib/supabase/client';

export type AuthResult = { ok: boolean; error?: string };

function setPersistMarker(keepSignedIn: boolean): void {
	document.cookie = keepSignedIn ? 'sb-no-persist=; path=/; max-age=0' : 'sb-no-persist=1; path=/';
}

function callbackUrl(): string {
	return `${window.location.origin}/auth/callback`;
}

/** Sends a magic link. On an anonymous user, converts it (preserving progress). */
export async function sendMagicLink(email: string, keepSignedIn: boolean): Promise<AuthResult> {
	const sb = createSupabaseClient();
	setPersistMarker(keepSignedIn);
	const {
		data: { user }
	} = await sb.auth.getUser();
	if (user?.is_anonymous) {
		// Convert the anonymous account to permanent, keeping its progress. The
		// confirmation link must return to our callback (not the Supabase Site URL).
		const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: callbackUrl() });
		return error ? { ok: false, error: error.message } : { ok: true };
	}
	const { error } = await sb.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true }
	});
	return error ? { ok: false, error: error.message } : { ok: true };
}

/** Starts Google OAuth. On an anonymous user, links Google to it (preserving progress). */
export async function startGoogle(keepSignedIn: boolean): Promise<AuthResult> {
	const sb = createSupabaseClient();
	setPersistMarker(keepSignedIn);
	const {
		data: { user }
	} = await sb.auth.getUser();
	const options = { redirectTo: callbackUrl() };
	const { error } = user?.is_anonymous
		? await sb.auth.linkIdentity({ provider: 'google', options })
		: await sb.auth.signInWithOAuth({ provider: 'google', options });
	return error ? { ok: false, error: error.message } : { ok: true };
}
