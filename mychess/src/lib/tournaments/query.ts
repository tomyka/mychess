import type { TournamentFilters } from './types';
import type { TimeControl, TournamentStatus } from './scraper-utils';

export const DEFAULT_PAGE_SIZE = 20;

const ALL_STATUSES: TournamentStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'FINISHED'];
const ALL_TIME_CONTROLS: TimeControl[] = ['STANDARD', 'RAPID', 'BLITZ', 'UNKNOWN'];
const ALL_COUNTRIES = ['Lithuania', 'Latvia'];

export function buildTournamentFilters(
  params: Partial<Record<string, string>>
): TournamentFilters {
  const status = params.status
    ? (params.status.split(',') as TournamentStatus[])
    : ALL_STATUSES;

  const timeControl = params.timeControl
    ? (params.timeControl.split(',') as TimeControl[])
    : ALL_TIME_CONTROLS;

  const country = params.country
    ? params.country.split(',')
    : ALL_COUNTRIES;

  const rawPage = parseInt(params.page ?? '1', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  return {
    status,
    timeControl,
    country,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
