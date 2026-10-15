-- Widen points column: numeric(4,1) overflows for tournaments with many rounds
ALTER TABLE public.tournament_players
  ALTER COLUMN points TYPE numeric(6,1);
