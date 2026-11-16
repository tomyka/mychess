# Training polish (#330)

Issue #330 (M2 Coaching), found by the M1 persona testers on the local persona stack (#258). Rulings R-205 to R-209 were given by the owner on 2026-11-16.

## The rulings applied

- R-205: a player setting "Show arrows when learning new moves", default on. Off, the learn pass skips the arrow round and goes straight to the blind round; a wrong answer shows the arrow as after a lapse (R-59). Not gated by tier (R-2). Extends R-144.
- R-206: a player may learn one chosen chapter or one chosen line from the repertoire page, besides the default chapter order; the daily new-move limit still applies (R-62, R-146).
- R-207: home lists the due count per repertoire under Today's review, each linking to a review of that repertoire alone (R-142); a mixed session's header names no single repertoire.
- R-208: PGN import previews have their own limit of 30 a minute per account; confirms keep 10 a minute (replaces the preview half of R-119).
- R-209: PGN import accepts pasted PGN text as well as a file, with the same limits (R-66, R-119, R-208) and the same preview.
- Unchanged and applied: R-54 (two answers: each review expects its own repertoire's move; a notice; nothing blocked), R-144 (learn pass), R-147 ("I know this"), R-148 (terms), R-174 (coach notes in learn and after the answer in review), R-180 (English UI for now), times shown in the user's time zone, Europe/Vilnius by default (CLAUDE.md).

## Lead decisions

1. **Arrows setting** is stored with the other training settings (`sessionSize`, `newPerDay`) as `learnArrows: boolean`, default `true`, in the settings form "Training" section. The learn session takes it as an option: `startLearnSession(line, { arrows })`; with `arrows: false` the session starts in the `blind` round. A wrong blind answer already shows the arrow (blindNew), so R-59's behaviour needs no new code path.
2. **Moves just reviewed are taught again with arrows** (tester finding): a defect, not a rule change. A learn plan must treat every key with a Review as `known`, including keys reviewed earlier in the same day and keys tracked through another repertoire (R-53: one Review per player and move). chess-dev reproduces it with a test first and fixes the cause.
3. **Learn one chapter or one line (R-206):** the training page takes `&chapter=<id>` or `&line=<chapterId>:<moveKey of the line's last move>` alongside `r=`, only with `mode=learn`. The learn plan gets an optional focus (`{ chapterId }` or `{ chapterId, lastKey }`) that restricts candidate lines; the daily allowance is unchanged. The repertoire page shows "Learn" on each chapter row and on the current line (where "I know this" already sits, R-147), with the count of new moves it would teach today; it is hidden when that count is 0.
4. **Two-answers notice (R-54):** shown after the answer (with the coach note, R-174), never before, so it cannot hint; written once ("Your other repertoire <name> plays <SAN> here"), not "1...e5: e5"; shown in learn too, on the new move's step. A notice from an inherited group assignment names the repertoire, which is enough; no rule change.
5. **Backlog view (R-207):** home's Today's review block lists each repertoire with due moves (name, side, due count), most urgent first as the session orders them, each linking to `/treniruote?mode=review&r=<id>`. The session header of a mixed session says "Several repertoires" (or the count) instead of the first card's name.
6. **Dates:** next-review and other date-times use the account's time zone (default Europe/Vilnius), a 24-hour clock (`hourCycle: 'h23'`) in both locales, and include the year when it is not the current year. One shared formatter config in `apps/web` (next-intl `formats`), used by `review-time.ts` and the other `format.dateTime` call sites that show a time.
7. **The second-answer refusal** in the builder ("You already have an answer in this position. Remove it first.") points to R-54: a second answer belongs in another repertoire. New text: "This repertoire already has a move here. To play another move, put it in a different repertoire." Text only; the domain refusal is unchanged.
8. **Import side default:** when the file's games share one `[White]`/`[Black]` header naming the account's display name or a linked Lichess username, the side defaults to that colour; otherwise White as today. The user can still change it.
9. **Import limits (R-208):** a separate `IMPORT_PREVIEW_RATE_LIMIT` (30 per minute) next to `IMPORT_RATE_LIMIT` (10 per minute, confirms only) in `packages/db/src/rate-limits.ts`.
10. **Paste (R-209):** the import page gets a textarea as an alternative to the file input; exactly one of the two is sent. The server reads both through the same zod schema and the same byte and half-move limits (R-66, R-119), then the same preview.
11. **"Learn (0)"** on a repertoire with new moves but no allowance left today shows "Daily limit reached: N new moves a day" with a link to the setting, instead of a 0 count.

## Design

- **chess** (`packages/chess/src/training/`): `learn-session.ts` (arrows option, decision 1), `learn-plan.ts` (focus, decision 3; the reviewed-again defect, decision 2), `answers.ts` if the two-answers wording needs data it does not return (decision 4).
- **domain** (`packages/domain/src/training.ts`): `learnArrows` in `trainingSettingsSchema` and the defaults.
- **db** (`packages/db`): the `learn_arrows boolean not null default true` column with the other training settings, a generated migration, the settings repository; `IMPORT_PREVIEW_RATE_LIMIT` and its use in the preview path (decision 9).
- **web** (`apps/web`): settings form (arrows toggle); training page search params and focus (decision 3); repertoire page Learn buttons; learn and review drills (two-answers notice placement, decision 4); home Today's review list and mixed header (decision 5); date formats (decision 6); refusal text (decision 7); import page side default and paste (decisions 8, 10); limit notice (decision 11). All text through the catalogues, en and lt.

## Testing

Test first per layer: learn session starts blind with `arrows: false` and a wrong blind answer shows the arrow; learn plan with focus yields only that chapter's or line's new moves within the allowance; a key reviewed today is `known`; settings schema accepts and defaults `learnArrows`; db round trip of the setting and the two rate limits (31st preview in a minute refused, previews do not use confirm allowance); web tests for each visible change. E2E: one journey per persona item (U1-M1-2 learn one line; D-M1 arrows off).

## Done means

Every bullet of #330 is fixed or ruled, the personas' journeys U1-M1-2 and the 2000+ learn journey pass on the local persona stack, and the gate is green.
