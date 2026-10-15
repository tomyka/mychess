import { createSupabaseClient } from '$lib/supabase/client';

export type AuthResult = { ok: boolean; error?: string };

function setPersistMarker(keepSignedIn: boolean): void {
	document.cookie = keepSignedIn ? 'sb-no-persist=; path=/; max-age=0' : 'sb-no-persist=1; path=/';
}

function callbackUrl(): string {
	return `${window.location.origin}/auth/callback`;
}

/**
 * Sends a magic link. This used to branch on an anonymous session first and
 * convert it via `updateUser` to preserve its progress; anonymous auth is
 * retired (#88 removed the minting, #90 purged the rows, the Supabase provider
 * is disabled), so the branch is gone along with the `getUser` round trip it
 * needed.
 */
export async function sendMagicLink(email: string, keepSignedIn: boolean): Promise<AuthResult> {
	const sb = createSupabaseClient();
	setPersistMarker(keepSignedIn);
	const { error } = await sb.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true }
	});
	return error ? { ok: false, error: error.message } : { ok: true };
}
