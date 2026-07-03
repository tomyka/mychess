import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { EmailOtpType } from '@supabase/supabase-js';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = url.searchParams.get('next');

	let errorMessage: string | null = null;
	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		errorMessage = error?.message ?? null;
	} else if (tokenHash && type) {
		const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		errorMessage = error?.message ?? null;
	} else {
		errorMessage = 'Invalid or expired authentication link.';
	}

	if (errorMessage) throw redirect(303, `/login?error=${encodeURIComponent(errorMessage)}`);

	const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
	throw redirect(303, dest);
};
