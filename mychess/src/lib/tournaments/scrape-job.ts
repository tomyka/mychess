import { createClient } from '@supabase/supabase-js';
import { scrapeTournamentList, scrapeTournamentDetails, scrapePlayers } from './scraper';
import type { ScrapedTournament } from './types';

export interface ScrapeJobResult {
  found: number;
  updated: number;
  detailsUpdated: number;
  playersUpdated: number;
  errors: string[];
}

/**
 * Run a full scrape job.
 * @param supabaseUrl  - SUPABASE_URL env var
 * @param serviceKey   - SUPABASE_SERVICE_ROLE_KEY env var (write access)
 */
export async function runScrapeJob(
  supabaseUrl: string,
  serviceKey: string
): Promise<ScrapeJobResult> {
  const db = createClient(supabaseUrl, serviceKey);
  const errors: string[] = [];

  // --- Log job start ---
  const { data: log } = await db.from('scrape_logs').insert({ status: 'running' }).select('id').single();
  const logId = log?.id as string | undefined;

  const result: ScrapeJobResult = { found: 0, updated: 0, detailsUpdated: 0, playersUpdated: 0, errors };

  try {
    // 1. Scrape federation list pages (LTU + LAT)
    const tournaments = await scrapeTournamentList();
    result.found = tournaments.length;

    // 2. Upsert list-level data
    for (const t of tournaments) {
      const { error } = await db.from('tournaments').upsert(
        {
          chess_results_id: t.chessResultsId,
          name: t.name,
          country: t.country,
          city: t.city ?? null,
          start_date: t.startDate?.toISOString() ?? null,
          time_control: t.timeControl,
          status: t.status,
          url: t.url,
          player_count: t.playerCount ?? null,
          last_scraped_at: new Date().toISOString(),
        },
        { onConflict: 'chess_results_id' }
      );
      if (error) errors.push(`Upsert ${t.chessResultsId}: ${error.message}`);
      else result.updated++;
    }

    // 3. Fetch details for tournaments missing start_date + a batch of stale ones
    const { data: missingDetails } = await db
      .from('tournaments')
      .select('id, chess_results_id, url')
      .is('start_date', null)
      .limit(50);

    const { data: staleDetails } = await db
      .from('tournaments')
      .select('id, chess_results_id, url')
      .not('start_date', 'is', null)
      .order('last_scraped_at', { ascending: true })
      .limit(20);

    const toDetail = [...(missingDetails ?? []), ...(staleDetails ?? [])];

    const BATCH = 5;
    for (let i = 0; i < toDetail.length; i += BATCH) {
      await Promise.all(
        toDetail.slice(i, i + BATCH).map(async (row) => {
          try {
            const details = await scrapeTournamentDetails(row.url);
            if (!details.startDate && !details.averageRating) return;

            const { error: updateError } = await db.from('tournaments').update({
              start_date: details.startDate?.toISOString() ?? null,
              end_date: details.endDate?.toISOString() ?? null,
              round_count: details.roundCount ?? null,
              organizer: details.organizer ?? null,
              chief_arbiter: details.chiefArbiter ?? null,
              average_rating: details.averageRating ?? null,
              player_count: details.playerCount ?? null,
              last_scraped_at: new Date().toISOString(),
            }).eq('id', row.id);

            if (updateError) {
              errors.push(`Details update ${row.chess_results_id}: ${updateError.message}`);
            } else {
              result.detailsUpdated++;
            }
          } catch (e) {
            errors.push(`Details ${row.chess_results_id}: ${String(e)}`);
          }
        })
      );
    }

    // 4. Status override: mark FINISHED based on dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await db.from('tournaments').update({ status: 'FINISHED' }).neq('status', 'FINISHED').or(
      `end_date.lt.${today.toISOString()},and(end_date.is.null,start_date.lt.${today.toISOString()})`
    );

    // 5. Scrape player lists for tournaments without players yet
    // Two-step anti-join: fetch tournament_ids that already have players,
    // then exclude them (PostgREST does not support inline subqueries).
    const { data: allTournaments } = await db
      .from('tournaments')
      .select('id, url')
      .order('last_scraped_at', { ascending: true })
      .limit(50);

    const candidateIds = (allTournaments ?? []).map(t => t.id);
    const withPlayers = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: withPlayersRows } = await db
        .from('tournament_players')
        .select('tournament_id')
        .in('tournament_id', candidateIds);
      (withPlayersRows ?? []).forEach(r => withPlayers.add(r.tournament_id));
    }

    const noPlayers = (allTournaments ?? [])
      .filter(t => !withPlayers.has(t.id))
      .slice(0, 10);

    for (const row of noPlayers) {
      try {
        const players = await scrapePlayers(row.url);
        if (players.length === 0) continue;

        // Two-pass upsert: players with fideId first, then those without
        const withFide = players.filter(p => p.fideId);
        const withoutFide = players.filter(p => !p.fideId);

        if (withFide.length > 0) {
          await db.from('tournament_players').upsert(
            withFide.map(p => ({
              tournament_id: row.id, name: p.name, fide_id: p.fideId,
              rating: p.rating ?? null, federation: p.federation ?? null,
              title: p.title ?? null, rank: p.rank ?? null, points: p.points ?? null,
            })),
            { onConflict: 'tournament_id,fide_id', ignoreDuplicates: false }
          );
        }

        if (withoutFide.length > 0) {
          await db.from('tournament_players').upsert(
            withoutFide.map(p => ({
              tournament_id: row.id, name: p.name, fide_id: null,
              rating: p.rating ?? null, federation: p.federation ?? null,
              title: p.title ?? null, rank: p.rank ?? null, points: p.points ?? null,
            })),
            { onConflict: 'tournament_id,name,rank', ignoreDuplicates: false }
          );
        }

        result.playersUpdated++;
      } catch (e) {
        errors.push(`Players ${row.id}: ${String(e)}`);
      }
    }

    // --- Log job success ---
    if (logId) {
      await db.from('scrape_logs').update({
        finished_at: new Date().toISOString(),
        status: errors.length === 0 ? 'success' : 'partial',
        message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        tournaments_found: result.found,
        tournaments_updated: result.updated,
      }).eq('id', logId);
    }
  } catch (e) {
    const msg = String(e);
    errors.push(msg);
    if (logId) {
      await db.from('scrape_logs').update({
        finished_at: new Date().toISOString(),
        status: 'error',
        message: msg,
      }).eq('id', logId);
    }
    throw e;
  }

  return result;
}
