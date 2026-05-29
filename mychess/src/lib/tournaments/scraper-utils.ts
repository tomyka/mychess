export type TimeControl = 'STANDARD' | 'RAPID' | 'BLITZ' | 'UNKNOWN';
export type TournamentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';

export const SUPPORTED_FEDERATIONS = [
  { code: 'LTU', name: 'Lithuania' },
  { code: 'LAT', name: 'Latvia' },
] as const;

export type FederationCode = (typeof SUPPORTED_FEDERATIONS)[number]['code'];

export interface ScrapedTournamentDetails {
  startDate?: Date;
  endDate?: Date;
  averageRating?: number;
  chiefArbiter?: string;
  organizer?: string;
  roundCount?: number;
  playerCount?: number;
}

export function parseTimeControl(code: string): TimeControl {
  switch (code.trim().toLowerCase()) {
    case 'st': return 'STANDARD';
    case 'rp': return 'RAPID';
    case 'bz': return 'BLITZ';
    default:   return 'UNKNOWN';
  }
}

export function parseStatusFromClass(divClass: string): TournamentStatus {
  if (divClass.includes('p_18')) return 'FINISHED';
  if (divClass.includes('p_17')) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

export function deriveStatus(
  scraped: TournamentStatus,
  startDate: Date | null | undefined,
  endDate?: Date | null
): TournamentStatus {
  if (scraped === 'FINISHED') return 'FINISHED';
  const effectiveEnd = endDate ?? startDate;
  if (!effectiveEnd) return scraped;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return effectiveEnd < today ? 'FINISHED' : scraped;
}

export function parseTournamentDetailField(
  label: string,
  value: string
): Partial<ScrapedTournamentDetails> {
  const result: Partial<ScrapedTournamentDetails> = {};

  if (label.includes('date') && value.match(/\d{4}\/\d{2}\/\d{2}/)) {
    const matches = value.match(/(\d{4})\/(\d{2})\/(\d{2})/g);
    if (matches) {
      const d = new Date(matches[0].replace(/\//g, '-'));
      if (!isNaN(d.getTime())) result.startDate = d;
      if (matches.length > 1) {
        const e = new Date(matches[1].replace(/\//g, '-'));
        if (!isNaN(e.getTime())) result.endDate = e;
      }
    }
  }

  if (label.includes('rating') && value.match(/\d+/)) {
    const m = value.match(/(\d+)/);
    if (m) result.averageRating = parseInt(m[1], 10);
  }

  if (label.includes('chief arbiter')) result.chiefArbiter = value;

  if (label.includes('organizer')) result.organizer = value.split(',')[0].trim();

  if (label.includes('number of rounds')) {
    const m = value.match(/(\d+)/);
    if (m) result.roundCount = parseInt(m[1], 10);
  }

  return result;
}
