import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseFideSearch } from '$lib/fide/search';

// Public FIDE player search (fide_players is public-read). Numeric query =
// FIDE-id prefix; text query = name contains. Returns up to 10 matches.
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const parsed = parseFideSearch(url.searchParams.get('q') ?? '');
	if (!parsed) return json({ results: [] });

	let query = supabase.from('fide_players').select('fide_id, name, federation');
	query =
		parsed.mode === 'id'
			? query.ilike('fide_id', `${parsed.value}%`)
			: query.ilike('name', `%${parsed.value}%`);

	const { data, error } = await query.order('name', { ascending: true }).limit(10);
	if (error) return json({ results: [], error: error.message }, { status: 500 });

	const results = (data ?? []).map((r: any) => ({
		fideId: r.fide_id,
		name: r.name,
		federation: r.federation
	}));
	return json({ results });
};
