// External API clients (CLAUDE.md, packages table): Lichess broadcast dumps and FIDE players (#316),
// Lichess broadcast tournaments through the token-authenticated API (#349).
export { BROADCAST_LIST_URL, broadcastMonths } from './broadcast-months';
export {
  BROADCAST_DUMP_LIMITS,
  broadcastDumpUrl,
  openBroadcastDump,
  type BroadcastDump,
} from './broadcast-dump';
export {
  BROADCAST_GAME_LIMITS,
  broadcastGames,
  type BroadcastGameRecord,
} from './broadcast-games';
export { USER_AGENT, type Fetch } from './http';
export {
  LICHESS_BROADCAST_PGN_MAX_BYTES,
  openLichessBroadcastPgn,
  type LichessBroadcastPgn,
} from './lichess-broadcast-pgn';
export {
  LICHESS_BROADCAST_REFUSALS,
  LICHESS_TOKEN_INVALID,
  lichessTokenSchema,
  type LichessApi,
  type LichessBroadcastRefusal,
  type LichessBroadcastResult,
} from './lichess-broadcast-request';
export {
  LICHESS_BROADCAST_MAX_PAGE,
  lichessBroadcastsBy,
  lichessBroadcastTour,
  lichessBroadcastTourOfRound,
  type LichessBroadcastPage,
  type LichessBroadcastRound,
  type LichessBroadcastTour,
  type LichessBroadcastTourDetail,
  type LichessListedTour,
} from './lichess-broadcast-tours';
export {
  FIDE_PLAYER_REFUSALS,
  lichessFidePlayer,
  type FidePlayer,
  type FidePlayerRefusal,
} from './lichess-fide-player';
