import * as cheerio from 'cheerio';
import {
  parseTimeControl,
  parseStatusFromClass,
  parseTournamentDetailField,
  SUPPORTED_FEDERATIONS,
} from './scraper-utils';
import type { ScrapedTournament, ScrapedPlayer } from './types';

const BASE_URL = 'https://chess-results.com';
const USER_AGENT = 'mychess/1.0 (https://github.com/tomyka/mychess)';

function parseDateFromName(name: string): { city?: string; startDate?: Date } {
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

export async function scrapeTournamentList(): Promise<ScrapedTournament[]> {
  const all: ScrapedTournament[] = [];
  for (const fed of SUPPORTED_FEDERATIONS) {
    const fedUrl = `${BASE_URL}/fed.aspx?lan=1&fed=${fed.code}`;
    const res = await fetch(fedUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`Failed to fetch ${fed.name} (${res.status})`);
      continue;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    $(`table.CRs2 tr.${fed.code}`).each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;
      const link = $(cells[1]).find('a');
      if (!link.length) return;
      const name = link.text().trim();
      const href = link.attr('href');
      if (!name || !href) return;
      const idMatch = href.match(/tnr(\d+)/);
      if (!idMatch) return;
      const chessResultsId = `tnr${idMatch[1]}`;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      let tcText = $(cells[2]).find('small').first().text().trim();
      if (!tcText) tcText = $(cells[2]).text().trim().split(/\s+/)[0] ?? '';
      const timeControl = parseTimeControl(tcText);
      const statusDivClass = $(cells[2]).find('div').first().attr('class') ?? '';
      const status = parseStatusFromClass(statusDivClass);
      const { city, startDate } = parseDateFromName(name);
      all.push({ chessResultsId, name, country: fed.name, city, startDate, timeControl, status, url });
    });
    console.log(`Scraped ${fed.name}: ${all.filter(t => t.country === fed.name).length} tournaments`);
  }
  return all;
}

export async function scrapeTournamentDetails(url: string): Promise<Partial<ScrapedTournament>> {
  const detailUrl = url.includes('turdet=') ? url : `${url}${url.includes('?') ? '&' : '?'}turdet=YES`;
  const res = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${detailUrl}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const details: Partial<ScrapedTournament> = {};
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const label = $(cells[0]).text().trim().toLowerCase();
    const value = $(cells[1]).text().trim();
    Object.assign(details, parseTournamentDetailField(label, value) as Partial<ScrapedTournament>);
  });
  // Player count from standings table
  const playerRows = $('tr.CRg1, tr.CRg2');
  if (playerRows.length > 0) {
    details.playerCount = playerRows.length;
  } else {
    let count = 0;
    $('table.CRs1 tr').each((_, row) => { if (!$(row).hasClass('CRng1b')) count++; });
    if (count > 0) details.playerCount = count;
  }
  return details;
}

export async function scrapePlayers(url: string): Promise<ScrapedPlayer[]> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const players: ScrapedPlayer[] = [];

  const playerRows = $('tr.CRg1, tr.CRg2');
  if (playerRows.length === 0) return [];

  // Find header row immediately preceding the first player row
  const firstRow = playerRows.first();
  const headerRow = firstRow.prev('tr');
  const colMap: Record<string, number> = {};
  headerRow.find('td, th').each((i, cell) => {
    const text = $(cell).text().trim().toLowerCase();
    if (/^no\.?$|^rank$|^rk$/.test(text))     colMap.rank = i;
    else if (/^name$/.test(text))               colMap.name = i;
    else if (/^tit(le)?$/.test(text))           colMap.title = i;
    else if (/^fed(eration)?$/.test(text))      colMap.federation = i;
    else if (/^fide.?id$|^fideid$/.test(text))  colMap.fideId = i;
    else if (/^rtg$|^rating$|^elo$/.test(text)) colMap.rating = i;
    else if (/^pts$|^points?$|^score$/.test(text)) colMap.points = i;
  });

  // Fallback column positions (common LTU/LAT page layout):
  // Rank(0) | Name(1) | Title(2) | Fed(3) | FIDE ID(4) | Rating(5) | Points(6)
  const getCol = (key: string, fallback: number) =>
    colMap[key] !== undefined ? colMap[key] : fallback;

  playerRows.each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 4) return;
    const getText = (i: number) => $(cells[i])?.text().trim() ?? '';

    const rankText   = getText(getCol('rank', 0));
    const name       = getText(getCol('name', 1));
    const title      = getText(getCol('title', 2)) || undefined;
    const federation = getText(getCol('federation', 3)) || undefined;
    const fideIdText = getText(getCol('fideId', 4));
    const ratingText = getText(getCol('rating', 5));
    const pointsText = getText(getCol('points', 6));

    if (!name || name.length < 2) return;

    const rank   = rankText && /^\d+$/.test(rankText) ? parseInt(rankText, 10) : undefined;
    const fideId = /^\d{7,9}$/.test(fideIdText) ? fideIdText : undefined;
    const rating = /^\d{3,4}$/.test(ratingText) ? parseInt(ratingText, 10) : undefined;
    const points = /^\d+(\.\d)?$/.test(pointsText) ? parseFloat(pointsText) : undefined;

    players.push({ name, fideId, rating, federation, title, rank, points });
  });

  return players;
}
