---
description: Work one size/small + auto-ok backlog issue end to end and open a PR
---

Work exactly **one** issue from the backlog, unattended, and stop. The rules
are in `docs/agent-team.md` > Autonomy and `CLAUDE.md`.

## 1. Take an issue

```
node scripts/factory/pick-backlog-issue.mjs --claim
```

It picks the oldest open issue labelled both `size/small` and `auto-ok`, not
`blocked`, with no open PR and no live claim, and comments to claim it.

If it prints **"No available auto-ok issues"**, stop and say so. Do not widen
the search: `auto-ok` is applied by a human on purpose.

$ARGUMENTS may name an issue number. Honour it only if the script lists it as
available; otherwise refuse.

## 2. Do the work

The normal workflow: read the issue, `docs/owner-rulings.md` and
`docs/CONTEXT.md`; test first; the quality gate (`node quality/gate.mjs check`)
green before committing.

## 3. Open a PR, do not merge

Work on a branch `auto/<issue>`, then `gh pr create` linking the issue. Never
push to `main` and never merge: the next supervised lead session reviews it.
Leave the issue open.

## 4. If you get stuck, block - do not improvise

Comment saying exactly what a human must supply, add the `blocked` label, push
partial work to the branch and name it, then stop. Never invent a product or
UX decision, and never weaken a failing test. Two failed attempts is a block.

The guard hook enforces the subagent, wall-clock and compaction caps; if one
fires, treat it as a block.
