import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { THEMES, AVATARS } from '$lib/cosmetics';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const p = profile as any;

  return {
    session,
    profile,
    themes: THEMES,
    avatars: AVATARS,
    currentTheme: p?.board_theme ?? 'classic',
    currentAvatar: p?.avatar_id ?? 'knight'
  };
};
