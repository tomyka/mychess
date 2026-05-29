import type { TimeControl, TournamentStatus } from './scraper-utils';

export interface ScrapedTournament {
  chessResultsId: string;
  name: string;
  country: string;
  city?: string;
  startDate?: Date;
  endDate?: Date;
  timeControl: TimeControl;
  status: TournamentStatus;
  url: string;
  playerCount?: number;
  averageRating?: number;
  roundCount?: number;
  chiefArbiter?: string;
  organizer?: string;
}

export interface ScrapedPlayer {
  name: string;
  fideId?: string;
  rating?: number;
  federation?: string;
  title?: string;
  rank?: number;
  points?: number;
}

export interface DbTournament {
  id: string;
  chess_results_id: string;
  name: string;
  country: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  time_control: string;
  status: string;
  player_count: number | null;
  average_rating: number | null;
  round_count: number | null;
  chief_arbiter: string | null;
  organizer: string | null;
  url: string;
  last_scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface DbTournamentPlayer {
  id: string;
  tournament_id: string;
  name: string;
  fide_id: string | null;
  rating: number | null;
  federation: string | null;
  title: string | null;
  rank: number | null;
  points: number | null;
}

export interface TournamentFilters {
  status: TournamentStatus[];
  timeControl: TimeControl[];
  country: string[];
  dateStart?: string;
  dateEnd?: string;
  page: number;
  pageSize: number;
}
