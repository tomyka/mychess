import { createClient } from '@supabase/supabase-js';
import { downloadPlayersList } from './download';
import { parseFidePlayersFromBytes } from './parse';
import { computeRanks } from './rank';

export interface FideImportResult {
  total: number;      // players parsed from the global list
  ltu: number;        // Lithuanian players found
  imported: number;   // rows upserted
  listDate: string;   // YYYY-MM-01
  errors: string[];
}

const CHUNK = 500;

/**
 * Full monthly FIDE import for Lithuania.
 * @param supabaseUrl PUBLIC_SUPABASE_URL
 * @param serviceKey  SUPABASE_SERVICE_ROLE_KEY (write access, bypasses RLS)
 */
export async function runFideImport(
  supabaseUrl: string,
  serviceKey: string,
  now: Date = new Date()
): Promise<FideImportResult> {
  const db = createClient(supabaseUrl, serviceKey);
  const currentYear = now.getFullYear();
  const listDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const errors: string[] = [];

  const { data: log } = await db
    .from('fide_import_logs')
    .insert({ status: 'running', list_date: listDate })
    .select('id')
    .single();
  const logId = log?.id as string | undefined;

  const result: FideImportResult = { total: 0, ltu: 0, imported: 0, listDate, errors };

  try {
    const bytes = await downloadPlayersList();
    // Stream-parse: the decompressed XML exceeds V8's max string length, so we
    // never hold it whole. Count every valid player and keep only Lithuanians.
    let total = 0;
    const ltu = parseFidePlayersFromBytes(bytes, (p) => {
      total++;
      return p.federation === 'LTU';
    });
    result.total = total;
    result.ltu = ltu.length;

    const ranked = computeRanks(ltu, currentYear);
    const nowIso = now.toISOString();

    for (let i = 0; i < ranked.length; i += CHUNK) {
      const rows = ranked.slice(i, i + CHUNK).map((p) => ({
        fide_id: p.fideId,
        name: p.name,
        federation: p.federation,
        sex: p.sex,
        birth_year: p.birthYear,
        std_rating: p.stdRating,
        rapid_rating: p.rapidRating,
        blitz_rating: p.blitzRating,
        country_rank: p.countryRank,
        age_bracket: p.ageBracket,
        age_group_rank: p.ageGroupRank,
        list_date: listDate,
        updated_at: nowIso,
      }));
      const { error } = await db.from('fide_players').upsert(rows, { onConflict: 'fide_id' });
      if (error) errors.push(`Upsert chunk ${i}: ${error.message}`);
      else result.imported += rows.length;
    }

    if (logId) {
      await db.from('fide_import_logs').update({
        finished_at: new Date().toISOString(),
        status: errors.length === 0 ? 'success' : 'partial',
        message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        players_imported: result.imported,
      }).eq('id', logId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    if (logId) {
      await db.from('fide_import_logs').update({
        finished_at: new Date().toISOString(),
        status: 'error',
        message: msg,
      }).eq('id', logId);
    }
    throw e;
  }

  return result;
}
