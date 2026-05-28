insert into public.avatars (id, name, svg_url) values
  ('knight',    'Sir Knight',   '/avatars/knight.svg'),
  ('pawn',      'Pawn Star',    '/avatars/pawn.svg'),
  ('bishop',    'Cool Bishop',  '/avatars/bishop.svg'),
  ('rook',      'Castle Rock',  '/avatars/rook.svg'),
  ('queen',     'Queen B',      '/avatars/queen.svg'),
  ('king',      'King Leo',     '/avatars/king.svg'),
  ('dragon',    'Dragon',       '/avatars/dragon.svg'),
  ('robot',     'ChessBot',     '/avatars/robot.svg'),
  ('unicorn',   'Unicorn',      '/avatars/unicorn.svg'),
  ('wizard',    'Wizard',       '/avatars/wizard.svg'),
  ('ninja',     'Chess Ninja',  '/avatars/ninja.svg'),
  ('astronaut', 'Space Champ',  '/avatars/astronaut.svg')
on conflict (id) do nothing;

insert into public.themes (id, name, light_square, dark_square) values
  ('classic', 'Classic', '#f0d9b5', '#b58863'),
  ('ocean',   'Ocean',   '#dee3e6', '#8ca2ad'),
  ('forest',  'Forest',  '#ffffdd', '#86a666'),
  ('candy',   'Candy',   '#ffd6e0', '#c9184a'),
  ('space',   'Space',   '#1a1a2e', '#16213e'),
  ('gold',    'Gold',    '#f9e4b7', '#c8a951')
on conflict (id) do nothing;

insert into public.piece_sets (id, name, sprite_url) values
  ('standard', 'Standard', '/pieces/standard/'),
  ('cartoon',  'Cartoon',  '/pieces/cartoon/'),
  ('pixel',    'Pixel',    '/pieces/pixel/'),
  ('animals',  'Animals',  '/pieces/animals/')
on conflict (id) do nothing;

insert into public.badges (id, name, description, icon_url, xp_reward) values
  ('first_move',  'First Move!',    'Complete your first training card',        '/badges/first_move.svg',  10),
  ('week_streak', '7-Day Streak',   'Train 7 days in a row',                   '/badges/week_streak.svg', 50),
  ('centurion',   'Centurion',      'Review 100 cards total',                  '/badges/centurion.svg',   25),
  ('uploader',    'PGN Master',     'Upload your first repertoire from a file', '/badges/uploader.svg',   15),
  ('level_5',     'Level 5!',       'Reach level 5',                           '/badges/level5.svg',     30)
on conflict (id) do nothing;
