import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { themeId, avatarId } = await request.json() as { themeId: string; avatarId: string };

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ board_theme: themeId, avatar_id: avatarId })
    .eq('id', user.id);

  if (updateErr) throw error(500, updateErr.message);

  return json({ ok: true });
};
