import type { TournamentFilters } from './types';
import type { TimeControl, TournamentStatus } from './scraper-utils';

export const DEFAULT_PAGE_SIZE = 20;

const ALL_STATUSES: TournamentStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'FINISHED'];
const ALL_TIME_CONTROLS: TimeControl[] = ['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN'];
const ALL_STATUSES_SET = new Set<string>(ALL_STATUSES);
const ALL_TIME_CONTROLS_SET = new Set<string>(ALL_TIME_CONTROLS);

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

export function buildTournamentFilters(
  params: Partial<Record<string, string>>
): TournamentFilters {
  // Trim whitespace from comma-separated tokens and filter invalid enum values
  const status = params.status
    ? (params.status.split(',').map(s => s.trim()).filter(s => ALL_STATUSES_SET.has(s)) as TournamentStatus[])
    : ALL_STATUSES;

  const timeControl = params.timeControl
    ? (params.timeControl.split(',').map(s => s.trim()).filter(s => ALL_TIME_CONTROLS_SET.has(s)) as TimeControl[])
    : ALL_TIME_CONTROLS;

  const country = params.country
    ? params.country.split(',').map(s => s.trim()).filter(Boolean)
    : ['Lithuania'];

  const rawPage = parseInt(params.page ?? '1', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  // Validate date strings to prevent RangeError crashes in consumers
  const dateStart = params.dateStart && isValidDateString(params.dateStart) ? params.dateStart : undefined;
  const dateEnd = params.dateEnd && isValidDateString(params.dateEnd) ? params.dateEnd : undefined;

  return {
    status: status.length > 0 ? status : ALL_STATUSES,
    timeControl: timeControl.length > 0 ? timeControl : ALL_TIME_CONTROLS,
    country: country.length > 0 ? country : ['Lithuania'],
    dateStart,
    dateEnd,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
