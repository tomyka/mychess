import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSupportedLocale } from '$lib/locale';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const locale = (body as { locale?: unknown } | null)?.locale;

	if (!isSupportedLocale(locale)) throw error(400, 'Unsupported locale');

	const { user } = await locals.safeGetSession();
	if (user) {
		const { error: dbError } = await locals.supabase
			.from('profiles')
			.update({ locale } as any)
			.eq('id', user.id);
		if (dbError) throw error(500, dbError.message);
	}

	return json({ ok: true });
};
