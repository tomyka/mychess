import type { PageServerLoad } from './$types';
import { THEMES, AVATARS } from '$lib/cosmetics';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const { session, profile } = await requireAccount(locals);

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
