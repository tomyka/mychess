import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFideLookup } from '$lib/server/fide-lookup';

export const load: PageServerLoad = async ({ url, locals }) => {
  await requireAccount(locals);
  const fideQuery = (url.searchParams.get('fide') ?? '').trim();
  const fideLookup = await loadFideLookup(locals.supabase, fideQuery);
  return { fideQuery, fideLookup };
};
