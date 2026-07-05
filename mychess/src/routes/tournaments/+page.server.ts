import type { PageServerLoad } from './$types';
import { buildTournamentFilters } from '$lib/tournaments/query';

export const load: PageServerLoad = async ({ url, locals }) => {
  const params = Object.fromEntries(url.searchParams.entries());
  const filters = buildTournamentFilters(params);
  const isCalendar = params.view === 'calendar';

  const { supabase } = locals;

  // Query the ranked view so live tournaments come first, then upcoming
  // tournaments (soonest first), with past events sinking to the bottom.
  // See migrations 0015 and 0018.
  let query = supabase
    .from('tournaments_ranked')
    .select('*', { count: 'exact' })
    .in('status', filters.status)
    .in('time_control', filters.timeControl)
    .in('country', filters.country)
    .order('is_live', { ascending: false })
    .order('is_past', { ascending: true, nullsFirst: false })
    .order('day_distance', { ascending: true, nullsFirst: false });

  // Calendar view loads all matching (up to 500); list view uses pagination.
  if (isCalendar) {
    query = query.limit(500);
  } else {
    query = query.range((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1);
  }

  if (filters.dateStart) query = query.gte('start_date', filters.dateStart);
  if (filters.dateEnd) {
    // Include the full end day: use start of the next day as exclusive upper bound
    const nextDay = new Date(filters.dateEnd);
    nextDay.setDate(nextDay.getDate() + 1);
    query = query.lt('start_date', nextDay.toISOString().slice(0, 10));
  }

  const { data: tournaments, count, error } = await query;

  // Check for stale data banner
  const { data: latestScrape } = await supabase
    .from('tournaments')
    .select('last_scraped_at')
    .order('last_scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastScrapedAt = latestScrape?.last_scraped_at ?? null;
  const isStale = lastScrapedAt
    ? Date.now() - new Date(lastScrapedAt).getTime() > 12 * 60 * 60 * 1000
    : false;

  return {
    tournaments: tournaments ?? [],
    total: count ?? 0,
    filters,
    isCalendar,
    lastScrapedAt,
    isStale,
    error: error?.message ?? null,
  };
};
