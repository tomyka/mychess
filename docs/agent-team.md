# Agent team

How Claude Code builds mychess as an autonomous software factory: one **lead**
session that talks to the owner, plus **teammates** with their own context, a
shared task list and messages to each other. It uses Claude Code's
experimental agent teams (<https://code.claude.com/docs/en/agent-teams>).
Modelled on `tomyka/sportbet_new`. Rulings: issue #226,
`docs/owner-rulings.md`.

## Setup

- **Turned on per user**, not in this repo. The owner's
  `~/.claude/settings.json` sets
  `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` and
  `"teammateMode": "in-process"` (Windows terminals have no split panes).
- **Roles live in `.claude/agents/`**, one file each. A file's `tools` limit
  what that teammate can do, and its body is added to the teammate's
  instructions. Every teammate also loads `CLAUDE.md`, and each role file
  points here, so the rules below are written once.
- `/agents` lists the roles. Claude Code picks up edits to `.claude/agents/`
  within seconds.

### Skills (prerequisites, ruling Q24)

Global, installed per user (`~/.claude/skills/` or plugins):

| Skill | Source | Used by / when |
| --- | --- | --- |
| `grill-me` | mattpocock/skills | lead, with the owner, before a large feature |
| `domain-modeling` | mattpocock/skills | lead, architect: `docs/CONTEXT.md`, `docs/adr/` |
| `prd` | github/awesome-copilot | lead, for a milestone PRD |
| `superpowers:brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `test-driven-development`, `verification-before-completion` | superpowers plugin | the brainstorm -> spec -> plan -> TDD pipeline |
| `mp-code-review` | mattpocock/skills (local name) | architect, per task |
| `improve-codebase-architecture`, `codebase-design` | mattpocock/skills | architect, per slice |
| `security-review` | built into Claude Code | security-reviewer |

Vendored in this repo (`.agents/skills/`, pinned in `skills-lock.json`):
`retro` (session retrospective, run by the lead at the end of each slice) and
`writing-for-agents` (for editing `CLAUDE.md`, role files and skills).
Claude Code finds them through the committed symlinks in `.claude/skills/`;
add a link there when vendoring another skill.

## Roles

| Role | Owns | Edits | Used for |
| --- | --- | --- | --- |
| lead (main session) | the plan, the task list, commits, GitHub issues | anything, but delegates | always |
| `architect` | `CLAUDE.md` rules, `docs/adr/`, `docs/CONTEXT.md`, codebase health | nothing in the repo | every slice |
| `backend-dev` | `packages/domain`, `packages/db` | those folders | almost every slice |
| `chess-dev` | `packages/chess` (incl. generated opening data) | those folders | repertoire, training, PGN, deviation |
| `web-dev` | `apps/web` (pages, components, actions, board) | that folder | every slice with a screen |
| `ux-designer` | tokens, global styles, `docs/design/`, visual sign-off | those | every slice with a screen |
| `integrations-dev` | `packages/integrations` | that folder | explorer (M2), M3 ecosystem |
| `qa` | acceptance criteria, persona journeys, E2E, fixtures, persona seeds | tests, fixtures, seeds | every slice |
| `security-reviewer` | privacy, auth, invites, admin, secrets | nothing | auth, coach access, deletion, admin, OAuth |
| `devops` | `.github/workflows/`, `infra/`, the production VM, Resend, env | those; asks before any cloud change | infrastructure, pipelines |

Persona testers (`.claude/agents/persona-*.md`, ruling Q18) are not team
members: the lead runs them against a local stack with the persona seeds at the end of each milestone, in
character, and files their findings as issues. See `docs/personas/README.md`.

Why these roles:

- **chess-dev apart from backend-dev:** chess correctness (position keys,
  transpositions, PGN edge cases, FSRS) is its own expertise and its own pure
  package.
- **ux-designer:** the product competes with chessbook and chessreps on
  feel.
- **integrations-dev:** five external sources with their own terms, rate
  limits and failure modes, kept out of the core.

## Which team for which stage

Three to five teammates at a time; each one costs tokens.

| Stage | Team |
| --- | --- |
| Scaffold, CI, infra | devops, architect |
| Chess core (PGN, graph, FSRS, taxonomy port) | chess-dev, qa, architect |
| Auth, invites, coach links, deletion | backend-dev, web-dev, security-reviewer, qa |
| Training screens, builder, coach dashboard | web-dev, ux-designer, chess-dev or backend-dev, qa |
| Text-heavy slices (onboarding, emails, digest) | web-dev, qa |
| Explorer, game import, FIDE and Lithuania ranking, tournaments | integrations-dev, backend-dev, qa, architect |
| End of milestone | qa + persona testers, architect (improve-codebase-architecture) |

## Pipeline

1. **Issue.** Every substantive request is a GitHub issue (see
   `docs/agents/issue-tracker.md`). `size/large` goes through steps 2-4;
   `size/small` starts at step 5.
2. **Grill / brainstorm** with the owner (`grill-me`,
   `superpowers:brainstorming`). Answers go to the issue and
   `docs/owner-rulings.md`.
3. **Spec**: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` with
   sections The rulings applied, Lead decisions, Design (domain, chess, db,
   web), Testing, Done means.
4. **Plan**: `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
   (`superpowers:writing-plans`), each task naming its role; security-sensitive
   tasks are marked `- SECURITY`, visible ones `- UX`. Before any code, the
   `ux-designer` checks every `- UX` task that changes a screen's layout
   against a height budget at 375x667 and 390x844 (what sits above the
   board, the board, and what stays reachable under it): in #381 part 4 the
   phone budget surfaced only at sign-off and cost two rework rounds.
5. **Each task goes:** developer (test first) -> `qa` (criteria, persona
   journeys) -> `architect` (`mp-code-review`) -> `security-reviewer` if marked
   -> `ux-designer` if visible -> the lead commits.
   The architect's review runs on each task's diff before it is committed,
   not on a batch at the slice's end: in S3, product rules that had
   slipped into `apps/web` surfaced only at the slice-close review.
6. **Each slice ends** with `improve-codebase-architecture` (owner picks the
   "deepen" follow-ups), a `retro`, and closing the issue with the commit
   range and CI result.
7. **Each milestone ends** with the persona testers on the local persona stack and the owner
   promoting to production.

## Working rules

- **Keep the owner's machine light (#273).** At most two working agents run
  at once. A teammate runs only its own package's tests (for example
  `pnpm --filter @mychess/db test`); the lead runs `node quality/gate.mjs
  check` once before each commit. Nobody runs `node quality/gate.mjs
  mutation` unless the owner asks: mutation testing is off (#295).
- **Only the lead commits and pushes.** Work lands on `main` (trunk-based).
  A teammate reports the files it changed, the commands it ran and their
  results.
- **Each teammate stays in its own folders.** A change needed elsewhere goes
  to the owning teammate through the lead.
- **Rules are never invented.** A question the rulings, CONTEXT, ADRs and spec
  do not answer goes to the owner through the lead.
- **No production data** reaches any teammate. Tests and persona testing use the
  persona seeds.
- **The working tree is shared.** Teammates never run `git stash`, `git checkout -- <file>`, `git reset` or `git clean`: in a shared tree they move other teammates' uncommitted work. To check whether a failure is yours, run only your own tests.
- **The index is shared too (#381 part 5).** A teammate's `git mv` or
  `git rm` stages into the one index, so the lead's next commit carries it
  (77428041 shipped a half-done rename). Teammates move and delete files
  with plain `mv`/`rm`; while teammates work, the lead checks
  `git diff --cached --stat` and commits named paths only
  (`git commit -- <paths>`), and never stages a hand-made partial hunk
  (cab31cd5 put an export inside another export list).
- **One owner per shared file while teammates run in parallel.** In #381
  part 5 two teammates rewrote `last-trained.tsx` and one overwrote the
  other's hook. The lead names, in each brief, which functions of a shared
  file (a loader, `en.json` keys) each teammate may touch, and teammates
  re-read the file right before every edit.
- **Before committing a shared file, read its staged diff hunk by hunk
  (#381 part 6).** A commit by named paths still carries every hunk of a
  shared file such as `en.json`: 40f753e6 shipped two keys of a task still
  in progress, and the push waited for that task. If a hunk belongs to
  unfinished work, commit later or leave the file out.
- **A server action that changes what the shell shows revalidates the
  layout** (`revalidatePath(ROUTES.home, 'layout')`), not `refresh()`: in
  #381 part 6 a new `loading.tsx` under Settings left the Coach tab stale
  after a prefetched navigation, and only E2E caught it (079a8ba2). Adding
  a loading boundary under a layout runs the E2E journeys through that
  route before the commit.
- **A decision sent while a teammate is mid-report can cross its report**
  (#381 part 6, twice). The lead restates the decision in one message and
  checks the next report against it before reviewing.
- **A loader or read whose shape changes runs the web feature suite**
  (`cd apps/web && npx vitest run --config vitest.feature.config.ts`), not
  only its own unit tests: in #381 part 5 CI found two feature files with
  stale field allowlists. Run web tests with their config
  (`vitest.component.config.ts` or `vitest.feature.config.ts`); db tests
  live in `packages/db/test/`.
- **Edit source with Edit and Write**, never with splice or concatenation
  scripts: in S7 a splice picked up another task's leftover scratch file and
  overwrote half a test file. Scratch files go in a subfolder named after
  your task. The `no-shell-source-edits.mjs` hook enforces it for source
  under `apps/` and `packages/` (`docs/quality-gates.md`, Hooks); `mv` and
  `git mv` stay allowed.
- **There is no Python on this machine.** Script with node (`node -e`, or an
  `.mjs` file in your scratch subfolder).
- **Never skip, weaken or delete a failing test** to reach green; a failing
  test is the finding.
- **The lead commits only on a check's exit code**, never through a pipe
  (`check | tail && git commit` hides a failure and the commit goes through,
  S5, e7d9de8). During the development phase (R-193) the check before a
  commit is format, lint, strict typecheck, the tests of the changed
  packages and the secret scan of the staged files (`git add` first, then
  `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 git /repo
  --pre-commit --staged --no-banner --redact`, prefixed with
  `MSYS_NO_PATHCONV=1` in Git Bash, which otherwise rewrites `/repo` to a
  Windows path and the scan fails; not `dir` with several paths,
  which scans the container; a fake test secret goes into
  `.gitleaksignore`), chained with `&&` and never piped (a pipe hides the
  exit code); CI runs the full gate (`node quality/gate.mjs
  check`) and E2E before it deploys, and a red run deploys nothing
  (R-213). Outside that phase it is the full gate.
- **The Stop hook pauses while teammates work** (#281): the lead creates
  `node_modules/.cache/ts-quality/team-running` when it dispatches
  teammates, so the hook does not run the gate on their red-phase tests. A
  marker older than three hours is ignored, so refresh it on a long slice and
  let it expire after the last report: the protected-path hook refuses an
  agent's `rm` under `node_modules/.cache/ts-quality/`. The gate before each
  commit still applies.
- **No command that can wait on stdin** (a bare `cat`, an interactive
  prompt): it hangs the teammate's shell, and stopping it may be refused (S5).
- **Silence is not progress.** With every handoff the lead starts a
  background timer (about 20 minutes); when it fires it checks the teammate
  is alive (`ListAgents`) and restarts a stalled one with the same brief plus
  "work incrementally, report progress". Long steps are time-boxed: a suite
  over 15 minutes is stopped and reported.
- **Owner steps** (cloud resources, secrets, DNS, anything costing money)
  come one instruction at a time and wait for the owner's yes.

## Autonomy (ruling Q20)

- A push to `main` deploys to production once the gate and E2E have passed; a red run deploys nothing (R-166, R-213). There is no staging.
- **Unattended backlog runs** (`/backlog-run`, `.claude/commands/backlog-run.md`)
  take only issues labelled both `size/small` and `auto-ok`. `auto-ok` is
  applied by the owner or the lead with the owner's yes, never by a run. A run
  works one issue on a branch, opens a PR and does not merge; the next
  supervised lead session reviews and merges. Caps (subagents, wall-clock,
  compaction) are enforced by `scripts/factory/backlog-run-guard.mjs`.
- A run that hits an undecided question stops, comments what is needed, and
  labels the issue `blocked`.

## Permissions

Teammates start with the lead's permission mode; their prompts appear in the
lead's session. "Edits nothing" and "tests only" are instructions, not locks:
the lead's review of every change before committing holds roles to them.

## Starting and steering a team

- Ask the lead in plain words, naming the roles: "Start an agent team for #N
  with chess-dev, qa and architect."
- **Up/Down** picks a teammate, **Enter** opens its transcript, **Escape**
  interrupts, **x** stops it, **Ctrl+T** shows the task list.
- Known limits: `/resume` and `/rewind` do not bring in-process teammates
  back; one team per session; teammates cannot start teammates.
