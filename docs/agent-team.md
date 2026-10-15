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
| `vercel:*` | vercel plugin | devops, web-dev |

Vendored in this repo (`.agents/skills/`, pinned in `skills-lock.json`):
`retro` (session retrospective, run by the lead at the end of each slice) and
`writing-for-agents` (for editing `CLAUDE.md`, role files and skills).

## Roles

| Role | Owns | Edits | Used for |
| --- | --- | --- | --- |
| lead (main session) | the plan, the task list, commits, GitHub issues | anything, but delegates | always |
| `architect` | `CLAUDE.md` rules, `docs/adr/`, `docs/CONTEXT.md`, codebase health | nothing in the repo | every slice |
| `backend-dev` | `packages/domain`, `packages/db` | those folders | almost every slice |
| `chess-dev` | `packages/chess`, `data/openings/` | those folders | repertoire, training, PGN, deviation |
| `web-dev` | `apps/web` (pages, components, actions, board) | that folder | every slice with a screen |
| `ux-designer` | tokens, global styles, `docs/design/`, visual sign-off | those | every slice with a screen |
| `i18n-content` | `apps/web/src/i18n/messages/`, `docs/glossary-lt.md`, `data/openings/lt/`, email copy | those | every slice with visible text |
| `integrations-dev` | `packages/integrations` | that folder | explorer (M2), M3 ecosystem |
| `qa` | acceptance criteria, persona journeys, E2E, fixtures, persona seeds | tests, fixtures, seeds | every slice |
| `security-reviewer` | privacy, auth, invites, admin, secrets | nothing | auth, coach access, deletion, admin, OAuth |
| `devops` | `.github/workflows/`, Vercel, Neon, Resend, env | those; asks before any cloud change | infrastructure, pipelines |

Persona testers (`.claude/agents/persona-*.md`, ruling Q18) are not team
members: the lead runs them against staging at the end of each milestone, in
character, and files their findings as issues. See `docs/personas/README.md`.

Why these roles:

- **chess-dev apart from backend-dev:** chess correctness (position keys,
  transpositions, PGN edge cases, FSRS) is its own expertise and its own pure
  package.
- **ux-designer and i18n-content:** the product competes with chessbook and
  chessreps on feel, and the audience reads Lithuanian first.
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
| Text-heavy slices (onboarding, emails, digest) | web-dev, i18n-content, qa |
| Explorer, game import, FIDE, LSF ratings, tournaments | integrations-dev, backend-dev, qa, architect |
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
   tasks are marked `- SECURITY`, visible ones `- UX`.
5. **Each task goes:** developer (test first) -> `qa` (criteria, persona
   journeys) -> `architect` (`mp-code-review`) -> `security-reviewer` if marked
   -> `ux-designer` and `i18n-content` if visible -> the lead commits.
6. **Each slice ends** with `improve-codebase-architecture` (owner picks the
   "deepen" follow-ups), a `retro`, and closing the issue with the commit
   range and CI result.
7. **Each milestone ends** with the persona testers on staging and the owner
   promoting to production.

## Working rules

- **Only the lead commits and pushes.** Work lands on `main` (trunk-based).
  A teammate reports the files it changed, the commands it ran and their
  results.
- **Each teammate stays in its own folders.** A change needed elsewhere goes
  to the owning teammate through the lead.
- **Rules are never invented.** A question the rulings, CONTEXT, ADRs and spec
  do not answer goes to the owner through the lead.
- **No production data** reaches any teammate. Tests and staging use the
  persona seeds.
- **Never skip, weaken or delete a failing test** to reach green; a failing
  test is the finding.
- **Silence is not progress.** With every handoff the lead starts a
  background timer (about 20 minutes); when it fires it checks the teammate
  is alive (`ListAgents`) and restarts a stalled one with the same brief plus
  "work incrementally, report progress". Long steps are time-boxed: a suite
  over 15 minutes is stopped and reported.
- **Owner steps** (cloud resources, secrets, DNS, anything costing money)
  come one instruction at a time and wait for the owner's yes.

## Autonomy (ruling Q20)

- A green `main` deploys to staging; only the owner promotes to production.
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
