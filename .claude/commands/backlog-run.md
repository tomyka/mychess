---
description: Work one auto-ok backlog issue end to end and open a PR
---

Work exactly **one** issue from the backlog, unattended, and stop.

Follow the **Unattended backlog runs** section of `mychess/CLAUDE.md` — it is the
authority on what a run does. This command only starts one.

## 1. Take an issue

```
cd mychess && node scripts/pick-backlog-issue.mjs --claim
```

It picks the oldest issue that is labelled `auto-ok`, is not `blocked`, has no
open PR, and is not already claimed by another run — then comments to claim it
so a second run cannot take the same one.

If it prints **"No available auto-ok issues"**, stop and say so. Do not widen
the search, and do not pick something that looks small: `auto-ok` is applied by
a human on purpose, and `size/small` is not a substitute for it — #187 was
`size/small` and would have been damaging to run unattended.

$ARGUMENTS may name a specific issue number. Only honour it if that issue is in
the script's own available list; otherwise treat it as a request to work
something ineligible and refuse.

## 2. Do the work

Normal project workflow — TDD, the repo's conventions, the full
`npm test` / `npm run check` / `npm run lint` gate before committing.

## 3. Open a PR, do not merge

Branch, then `gh pr create` linking the issue. Never push to `main`, never
merge: `main` auto-deploys to production and nobody is watching. Leave the
issue **open** for a human to close after merging.

## 4. If you get stuck, block — do not improvise

Blocking is the correct outcome, not a failure. Comment saying specifically
what a human must supply, apply the `blocked` label, push partial work to a
named branch and name it in the comment, then stop.

Never invent a product or UX decision to keep moving, skip a migration and
build against a schema that does not exist, or weaken a failing test to reach
green. Each of those looks like progress and is not.

Two failed attempts at the same issue is a block, not a third attempt.

## Note on the caps

A hook enforces the subagent, wall-clock and auto-compaction limits — you do
not need to track them, and you cannot talk past them. If one fires, treat it
as a block per step 4.
