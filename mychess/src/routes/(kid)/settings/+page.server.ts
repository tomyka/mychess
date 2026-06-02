import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fetchFideName } from '$lib/server/fide';

export const load: PageServerLoad = async ({ locals: { safeGetSession }, url }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const p = profile as any;

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername: p?.lichess_username ?? '',
    fideId: p?.fide_id ?? '',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
    oauthError: url.searchParams.get('oauth_error') ?? null
  };
};

export const actions: Actions = {
  save: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const firstName = (fd.get('first_name') as string ?? '').trim();
    const lastName = (fd.get('last_name') as string ?? '').trim();
    const fideId = (fd.get('fide_id') as string ?? '').trim();

    if (fideId) {
      if (!firstName || !lastName) {
        return fail(400, { error: 'First and last name are required when a FIDE ID is set.' });
      }

      const { data: current } = await supabase
        .from('profiles')
        .select('fide_id')
        .eq('id', user.id)
        .single();

      const storedFideId = (current as any)?.fide_id ?? '';
      if (fideId !== storedFideId) {
        const fideName = await fetchFideName(fideId);
        if (!fideName) {
          return fail(400, { error: 'Could not look up FIDE profile. Check your FIDE ID.' });
        }

        const normalize = (s: string) => s.trim().toLowerCase();
        if (
          normalize(firstName) !== normalize(fideName.firstName) ||
          normalize(lastName) !== normalize(fideName.lastName)
        ) {
          return fail(400, { error: 'Name does not match FIDE profile.' });
        }
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        fide_id: fideId || null
      } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  disconnect_chesscom: async ({ locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const { error } = await supabase
      .from('profiles')
      .update({ chesscom_username: null } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  disconnect_lichess: async ({ locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const { error } = await supabase
      .from('profiles')
      .update({ lichess_username: null } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
