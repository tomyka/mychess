import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const { supabase } = locals;

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .single();

  if (tErr || !tournament) {
    throw error(404, 'Tournament not found');
  }

  const { data: players, error: pErr } = await supabase
    .from('tournament_players')
    .select('*')
    .eq('tournament_id', params.id)
    .order('rank', { ascending: true, nullsFirst: false });

  if (pErr) console.error('Players query failed:', pErr);

  return { tournament, players: players ?? [] };
};
