// The E2E app's community broadcast switches (#349): a Lichess token, so the
// community part is on, and the nightly route's secret, so a journey can run
// the night. Neither is a secret: the token is in Lichess's form but no
// Lichess token, and the app under test sends it only to the fixture fetch
// (src/server/broadcast-fixture-fetch.ts); the cron secret guards only the
// throwaway E2E app. playwright.config.ts gives both to the app it starts;
// infra/compose/e2e.yml sets the same values for CI's stack.

/** The app's LICHESS_TOKEN, unless the environment sets another. */
export const E2E_LICHESS_TOKEN =
  process.env['LICHESS_TOKEN'] ?? 'lip_SyntheticToken123';

/** The app's CRON_SECRET (32 characters at least), unless set. */
export const E2E_CRON_SECRET =
  process.env['CRON_SECRET'] ?? 'e2e-only-cron-secret-not-a-secret-0123';
