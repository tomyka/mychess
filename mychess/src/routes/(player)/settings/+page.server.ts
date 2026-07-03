import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fetchFideName } from '$lib/server/fide';
import { fetchLichessRatings } from '$lib/server/lichess';
import { fullNameOrNull } from '$lib/profile';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session, profile } = await requireAccount(locals);

  const p = profile as any;
  const lichessUsername = p?.lichess_username ?? '';
  const lichessRatings = lichessUsername ? await fetchLichessRatings(lichessUsername) : null;

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername,
    lichessRatings,
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

    const chesscomUsername = (fd.get('chesscom_username') as string ?? '').trim();
    if (chesscomUsername) {
      const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(chesscomUsername)}`);
      if (!res.ok) {
        return fail(400, { error: 'Chess.com username not found. Check the spelling.' });
      }
    }

    // Keep display_name in sync with the player's real name so converted
    // guests stop showing up as "Guest". Only set it when a name is present.
    const displayName = fullNameOrNull(firstName, lastName);

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        fide_id: fideId || null,
        chesscom_username: chesscomUsername || null,
        ...(displayName ? { display_name: displayName } : {})
      } as any)
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
