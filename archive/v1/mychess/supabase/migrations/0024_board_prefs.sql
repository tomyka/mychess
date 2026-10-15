-- 0024_board_prefs.sql
-- Per-user chess board appearance preferences (theme, piece set, animation,
-- coordinates, last-move highlight). Missing keys are filled with defaults in
-- application code (see src/lib/board/prefs.ts), so an empty object is valid.
alter table profiles
  add column if not exists board_prefs jsonb not null default '{}'::jsonb;
