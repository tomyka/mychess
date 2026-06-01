import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fetchFideName } from '$lib/server/fide';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, first_name, last_name, chesscom_username, lichess_username, fide_id')
    .eq('id', user.id)
    .single();

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: (p as any)?.first_name ?? '',
    lastName: (p as any)?.last_name ?? '',
    chesscomUsername: (p as any)?.chesscom_username ?? '',
    lichessUsername: (p as any)?.lichess_username ?? '',
    fideId: (p as any)?.fide_id ?? ''
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
    const chesscomUsername = (fd.get('chesscom_username') as string ?? '').trim();
    const lichessUsername = (fd.get('lichess_username') as string ?? '').trim();

    if (fideId) {
      if (!firstName || !lastName) {
        return fail(400, { error: 'First and last name are required when a FIDE ID is set.' });
      }

      const fideName = await fetchFideName(fideId);
      if (!fideName) {
        return fail(400, { error: 'Could not look up FIDE profile. Check your FIDE ID.' });
      }

      const normalize = (s: string) => s.trim().toLowerCase();
      if (
        normalize(firstName) !== normalize(fideName.firstName) ||
        normalize(lastName) !== normalize(fideName.lastName)
      ) {
        return fail(400, {
          error: `Name does not match FIDE profile. Expected: ${fideName.firstName} ${fideName.lastName}.`
        });
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        chesscom_username: chesscomUsername || null,
        lichess_username: lichessUsername || null,
        fide_id: fideId || null
      } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
