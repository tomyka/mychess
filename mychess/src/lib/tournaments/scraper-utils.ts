export type TimeControl = 'STANDARD' | 'RAPID' | 'BLITZ' | 'UNKNOWN';
export type TournamentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';

export const SUPPORTED_FEDERATIONS = [
  { code: 'LTU', name: 'Lithuania' },
  { code: 'LAT', name: 'Latvia' },
] as const;

type FederationCode = (typeof SUPPORTED_FEDERATIONS)[number]['code'];

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

/** Extracts a city and start date from a chess-results.com tournament name, e.g. "Vilnius Open (Vilnius, 2026-06-07)". */
export function parseDateFromName(name: string): { city?: string; startDate?: Date } {
  const cityPatterns = [
    /\(([A-Za-zÀ-žĀ-ž\s]+),/,
    /(?:^|\s)(Vilnius|Kaunas|Klaipėda|Šiauliai|Panevėžys|Druskininkai|Visaginas|Alytus|Riga|Daugavpils)/i,
  ];
  let city: string | undefined;
  for (const p of cityPatterns) {
    const m = name.match(p);
    if (m) { city = m[1].trim(); break; }
  }

  let startDate: Date | undefined;
  const isoMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) startDate = d;
  }
  if (!startDate) {
    const shortDateMatch = name.match(/,\s*(\d{2}-\d{2})\s*\)/);
    if (shortDateMatch) {
      const d = new Date(`${new Date().getFullYear()}-${shortDateMatch[1]}`);
      if (!isNaN(d.getTime())) startDate = d;
    }
  }
  if (!startDate) {
    const dayMatch = name.match(/\((\d{2})\s+(\d{2})-\d{2}\)/);
    if (dayMatch) {
      const d = new Date(`${new Date().getFullYear()}-${dayMatch[1]}-${dayMatch[2]}`);
      if (!isNaN(d.getTime())) startDate = d;
    }
  }
  return { city, startDate };
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
