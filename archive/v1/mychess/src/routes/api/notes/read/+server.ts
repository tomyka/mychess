import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const user = await requireApiUser(locals);

  const { noteId } = await request.json() as { noteId: string };

  const { error: updateErr } = await supabase
    .from('coach_notes')
    .update({ read_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('player_id', user.id)
    .is('read_at', null);

  if (updateErr) throw error(500, updateErr.message);

  return json({ ok: true });
};
