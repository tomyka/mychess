-- Story #101 of epic #95: account-level badges for repertoires learned and
-- mastered.
--
-- These four are the only badges in the system that can be REVOKED (see
-- REVOCABLE_BADGE_IDS in src/lib/badges/recalc.ts). They track current state
-- rather than a lifetime total: a repertoire drops out of Learned when a coach
-- adds material or a line is demoted, and out of Mastered when either happens.
-- Losing the status loses the badge, decided explicitly with the product owner.
-- Deleting the badges_earned row is also what allows re-earning it later, since
-- the eligibility check suppresses anything already in `earnedIds`.

insert into public.badges (id, name, description, icon_url, xp_reward) values
  ('first_repertoire_learned',  'Repertoire Learned',  'Learn every line in a repertoire — twice each, a day apart',   '/badges/first_repertoire_learned.svg',  50),
  ('repertoires_learned_5',     'Five Learned',        'Have five repertoires fully learned at once',                  '/badges/repertoires_learned_5.svg',    100),
  ('first_repertoire_mastered', 'Repertoire Mastered', 'Play every chapter of a repertoire unaided, one chapter per sitting', '/badges/first_repertoire_mastered.svg', 100),
  ('repertoires_mastered_5',    'Five Mastered',       'Have five repertoires mastered at once',                       '/badges/repertoires_mastered_5.svg',   200)
on conflict (id) do nothing;
