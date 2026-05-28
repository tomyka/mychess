import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: p } = await supabase
    .from('profiles')
    .select('display_name, chesscom_username, lichess_username')
    .eq('id', user.id)
    .single();

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    chesscomUsername: (p as any)?.chesscom_username ?? '',
    lichessUsername: (p as any)?.lichess_username ?? ''
  };
};

export const actions: Actions = {
  save: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const chesscomUsername = (fd.get('chesscom_username') as string ?? '').trim();
    const lichessUsername = (fd.get('lichess_username') as string ?? '').trim();

    const { error } = await supabase
      .from('profiles')
      .update({
        chesscom_username: chesscomUsername || null,
        lichess_username: lichessUsername || null
      } as any)
      .eq('id', user.id);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
