# Factory roadmap

Where the mychess software factory stands against current industry practice,
and a phased plan to move it forward. Issue #367, written 2026-11-18. This is a
proposal: the decisions in "Owner decisions" are open until the owner rules,
and nothing here reopens an existing ruling or ADR.

## 1. Industry practice (2026)

| Source | Core idea | What it implies for us |
| --- | --- | --- |
| Dan Shapiro, "The Five Levels: from Spicy Autocomplete to the Dark Factory" (Jan 2026) | Levels 0-5 modelled on driving automation. Level 3: the human manages agents and reviews their diffs. Level 4: the human writes specs and checks outcomes, not code. Level 5 ("dark factory"): specs in, software out, no human writes or reviews code. | Progress is gated by **verification**, not by model intelligence: you can only stop reading diffs when something else proves the change correct. |
| StrongDM Software Factory (Feb 2026) | Specs and **scenarios** drive agents; scenarios are kept **outside the repo** so coding agents cannot see or game them; a "Digital Twin Universe" of behavioural clones of third-party services (Okta, Slack, Jira, ...) lets agents test end to end; "satisfaction" (share of scenario runs a judge accepts) replaces pass/fail code review. | Holdout acceptance scenarios and twins of external services are the two pieces that let validation replace review. Critics (Stanford CodeX) point out accountability moves upstream to whoever writes scenarios, not away. |
| OpenAI, "Harness engineering: leveraging Codex in an agent-first world" (Feb 2026); Böckeler's commentary on martinfowler.com | ~1M lines with no hand-written code. The repo is optimised for agent legibility: a short map (AGENTS.md) pointing to versioned design docs, rigid mechanically-enforced architecture, agents review agents until all reviewers are satisfied, recurring "garbage collection" agents fix drift. Böckeler frames it as **guides** (feed-forward context) and **sensors** (feedback checks), deterministic and LLM-based. | Every recurring human correction should become a guide (doc/skill) or a sensor (lint rule, test, hook). |
| DORA 2025, State of AI-assisted Software Development + AI Capabilities Model | AI is an amplifier: it improves teams that already have a quality internal platform, small batches, strong version-control practice, a clear AI policy, user focus and accessible internal data; it worsens instability where those are missing. Throughput and stability (the four keys) remain the outcome measures. | Measure lead time, deploy frequency, change-fail rate and recovery time for the factory itself, and keep batches small. |

Common thread: the human moves from writing and reading code to **writing
intent (specs, rulings, scenarios) and judging outcomes**, and that move is
only safe when automated verification is fast, trustworthy and independent of
the agent that wrote the code.

## 2. Where mychess stands

Overall: **solid Level 3, with several Level 4 foundations already in place.**
Agents write all code, but every change passes through one supervised lead
session that reviews, gates and commits it.

### Strengths (already at or ahead of practice)

- **Guides**: `CLAUDE.md` as a map, `docs/CONTEXT.md`, ADRs, 200+ owner
  rulings, per-slice specs and plans (19 specs, 15 plans), role files in
  `.claude/agents/`, vendored skills. Matches the harness-engineering "map plus
  versioned docs" pattern.
- **Deterministic sensors**: format, lint, strict typecheck, coverage
  thresholds, CRAP, knip, dependency-cruiser layering, suppression ban; the
  gate config is protected from agent edits by a hook. This is the "rigid
  architecture, mechanically enforced" pattern.
- **LLM sensors**: architect (`mp-code-review` per task), security-reviewer,
  ux-designer and i18n-content sign-offs, `improve-codebase-architecture` per
  slice.
- **Continuous deployment with automatic rollback** (R-166, R-192): trunk-based,
  a green `main` reaches production, failed gate or E2E rolls back.
- **Persona testers** (four personas with seeds): the closest thing to
  scenario-based validation, but run by hand at milestone end.
- **Contract tests and recorded fixtures** for Lichess
  (`packages/integrations/src/lichess.contract.test.ts`, `fixtures/`): the
  seed of a twin.
- **Throughput**: about 260 commits and 103 issues closed in the month since
  the v2 kickoff (2026-10-16).

### Gaps (evidence)

| # | Gap | Evidence | Level it blocks |
| --- | --- | --- | --- |
| G1 | The lead session is the single integration point and must be live for every task. | ADR 0007; `docs/agent-team.md` pipeline step 5. | 4 |
| G2 | The unattended lane exists but has never run in v2. | `/backlog-run`, `pick-backlog-issue.mjs` and the guard exist; all 6 `auto-ok` issues ever labelled (#169-#205) predate the v2 epic #225; no `auto/*` PR in v2. | 4 |
| G3 | Slow feedback. | A push takes 15-20 min to confirm on `main` (last 15 runs), 17-30 min per #366. | 3 -> 4 |
| G4 | `main` is red too often for unattended work. | 8 of the last 40 `ci.yml` runs on `main` failed (20%); 3 consecutive failures on 2026-11-16/17. | 4 |
| G5 | Validation is not independent of the builder. | Acceptance tests and E2E are written in the same repo, often by the same session that wrote the code; persona journeys run only at milestone end. | 4 -> 5 |
| G6 | Test strength is unmeasured. | Mutation testing runs nowhere (#295); coverage alone does not show assertions are strong. | 4 |
| G7 | No factory metrics. | Nothing records lead time per issue, change-fail rate, rollbacks, rework, or tokens/cost per issue. | all |
| G8 | Learning loop is manual. | Retros run per slice, but their lessons reach `docs/agent-team.md` by hand (for example the S5 pipe rule, the S7 splice rule); there is no record of which became a sensor. | 4 |
| G9 | Capacity is capped by one machine. | #273: at most two working agents; the gate needs local Docker and runs once per tree. | 4 |
| G10 | External services have recordings, not twins. | Lichess has fixtures; FIDE, chess-results, Chess.com and Resend have no behavioural fake an agent can drive end to end. | 5 |

## 3. Plan

Five phases. Each ends with a measurable exit criterion; a phase starts only
when the previous one exits. Each bullet becomes its own issue when the owner
picks the phase.

### Phase 0 - Measure the factory (size/small, 1 week)

- `scripts/factory/scorecard.mjs`: from `gh` data, weekly: deploy frequency,
  lead time (issue opened -> closed, commit -> production), `main` change-fail
  rate, rollbacks, mean time to green, CI duration p50/p90, reopened issues.
- Record tokens/cost and wall-clock per issue in the issue's closing comment
  (the lead already closes with commit range and CI result).
- **Exit:** two weekly scorecards committed under `docs/factory/`, giving the
  baseline every later phase is judged against.

### Phase 1 - Fast, trustworthy feedback (G3, G4, G6)

- Finish #366: shard E2E, speed up the gate's test step. Target p90 < 10 min.
- Flaky-test triage: every red `main` run gets a cause label (real defect,
  flake, infra); flakes are quarantined by issue, never by skipping silently.
- Nightly mutation run on files changed in the last 24 h (by hand today, #295
  needs the owner to lift it), results posted to an issue; surviving mutants
  become `size/small` issues.
- **Exit:** `main` green rate >= 95% over two weeks; CI p90 < 10 min.

### Phase 2 - Open the unattended lane (G1, G2, G9)

- Triage the backlog for `auto-ok` candidates with the owner (the owner or the
  lead with the owner's yes applies the label, ADR 0007).
- Run `/backlog-run` off the owner's machine: a scheduled cloud agent
  (`/schedule`) or a GitHub Actions runner, so it is not bound by #273.
- Agent review on every `auto/*` PR before a human sees it: architect
  (`mp-code-review`), security-reviewer when the diff touches the R-listed
  sensitive surfaces, `quality.yml` green. The lead then reads the review
  summary and the scenario results, not the whole diff.
- **Exit:** 10 `auto-ok` PRs merged with zero rollbacks and no rework issue
  filed within a week of each.

### Phase 3 - Independent validation (G5, G10)

- **Holdout scenarios.** Convert the persona journeys (`docs/personas/`) into
  executable scenarios stored outside the coding agents' view (a separate
  private repo or a path the role agents are told not to read, enforced by a
  PreToolUse hook). A scenario runner drives the deployed app with Playwright
  as each persona; an LLM judge scores each run against the journey's intent.
  "Satisfaction" (share of scenario runs judged good) is a release signal
  beside E2E.
- Only the owner and `qa` (in a dedicated, non-coding session) write scenarios:
  accountability stays with whoever states intent.
- **Twins.** Grow the Lichess fixtures into a behavioural fake server (same
  HTTP surface, stateful), then FIDE-LTU, chess-results and Chess.com, and a
  Mailpit-based twin for Resend (already used locally). Persona stack and E2E
  run against twins, never the real services.
- **Exit:** every M1/M2 persona journey runs nightly against production-like
  stack; satisfaction tracked on the scorecard for four weeks.

### Phase 4 - Spec-in, software-out for medium work (Level 4)

- For `size/medium` issues whose spec is approved by the owner: the plan is
  executed by `subagent-driven-development` in a cloud session, reviewed by
  agents, and merged when gate + E2E + holdout scenarios pass. The lead and
  owner review **specs, scenarios and rulings**, not diffs.
- Keep a human diff review for: migrations, auth/session/coach-access changes
  (security-reviewer surfaces), infra and deploy changes.
- **Exit:** a full slice delivered this way with change-fail rate and
  rework no worse than the Phase 0 baseline.

### Phase 5 - Self-improving harness (G8)

- Every retro finding is classified as **guide** (doc/skill/role-file change)
  or **sensor** (lint rule, test, hook, gate check) and filed as an issue;
  the scorecard counts how many findings became sensors.
- Weekly garbage-collection run: doc drift (`CLAUDE.md`, `docs/operations.md`
  vs the code), dead code (knip), CRAP top 20, stale `blocked` issues,
  rulings referenced nowhere.
- **Exit:** a retro lesson recurs at most once before it becomes a sensor.

### What stays human, at every level

Product rules and rulings (CLAUDE.md: never invent a product rule), scenario
authorship, cloud resources and money (owner steps), anything touching
production data, and the kill switch: removing `auto-ok` or pausing the
scheduled run stops the lane at once.

## 4. Owner decisions

1. **Target level.** Level 4 (humans own specs, scenarios and sensitive-surface
   review) is the recommendation; Level 5 is not advised while one person is
   both owner and sole accountable party for a product handling player data.
2. **Where unattended runs execute** (cloud scheduled agent vs a self-hosted
   runner on the Oracle VM vs the owner's machine). Running on the VM touches
   production infrastructure and is the riskiest.
3. **Mutation testing**: lift #295 for a nightly changed-files run?
4. **Holdout location**: a private second repo (strongest isolation) or a
   hook-protected folder in this repo (simpler).
5. **Ordering**: Phase 0 and Phase 1 first (recommended), or Phase 2 in
   parallel with Phase 1.

## Sources

- Dan Shapiro, "The Five Levels", summarised by Simon Willison:
  <https://simonwillison.net/2026/Jan/28/the-five-levels/>
- "The Five Levels Are Gated by Verification, Not Intelligence":
  <https://understandingdata.com/posts/five-levels-gated-by-verification/>
- StrongDM, "The StrongDM Software Factory":
  <https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai>,
  <https://factory.strongdm.ai/>; Simon Willison's write-up:
  <https://simonwillison.net/2026/Feb/7/software-factory/>
- Stanford CodeX, "Built by Agents, Tested by Agents, Trusted by Whom?":
  <https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/>
- OpenAI, "Harness engineering": <https://openai.com/index/harness-engineering/>
- Birgitta Böckeler, "Harness Engineering - first thoughts":
  <https://www.martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html>
- DORA 2025 AI Capabilities Model: <https://dora.dev/ai/capabilities-model/>;
  2025 State of AI-assisted Software Development:
  <https://services.google.com/fh/files/misc/2025_state_of_ai_assisted_software_development.pdf>
