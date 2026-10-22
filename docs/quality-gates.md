# Quality gates

One runner, `quality/gate.mjs`, for people, agent hooks and CI alike. Thresholds live in `quality/quality.config.json` (coverage 80/75/80/80, CRAP 30, mutation 60 on changed files and 50 on the full run). The gate configs are protected from agent edits by `quality/hooks/protect-config.mjs`; change them by hand.

## Commands

| Command                                       | What it runs                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` (`node quality/gate.mjs check`)  | The fast gate: format, lint, typecheck (strict), forbidden markers, tests + coverage, CRAP, dead code (knip), architecture (depcruise) |
| `node quality/gate.mjs check --only lint,test` | Selected gates only                                                                                                                  |
| `pnpm mutation`                               | Mutation-test uncommitted source changes (Stryker)                                                                                    |
| `node quality/gate.mjs mutation --branch`     | Mutation-test changes against `origin/main` (pull requests); add `--base <ref>` to diff against another ref (pushes)                  |
| `pnpm mutation:full`                          | Mutation-test everything; shard it with `--full --shard i/N`, then `--merge`                                                         |
| `pnpm check:all`                              | `check` plus mutation of uncommitted changes                                                                                          |
| `pnpm fix`                                    | Prettier write + `eslint --fix`                                                                                                       |
| `pnpm crap`                                   | The 20 worst functions by CRAP score                                                                                                  |

Separate suites: `pnpm test:unit` (domain, chess), `pnpm test:component` (web), `pnpm test:db` (db, on a Testcontainers Postgres: needs Docker). `pnpm check` runs all of them in one vitest run over the workspace, so it needs Docker too.

## Hooks (`.claude/settings.json`)

- **PreToolUse** `protect-config.mjs`: refuses agent edits to the gate configs and `--no-verify`.
- **PostToolUse** `post-edit.mjs`: formats the edited file, `eslint --fix`es it and reports what is left.
- **Stop** `stop-gate.mjs`: runs `gate.mjs check` (the fast gate, no mutation: `stopHook.mutation` is `"off"`), skipping when the tree is unchanged since the last pass, and gives up blocking after `stopHook.maxConsecutiveBlocks` failures.

## CI

- `.github/workflows/quality.yml` is the only workflow (#261). On pushes to main and pull requests: `gate.mjs check` (format, lint, typecheck, every test suite with coverage including the db suite, CRAP, dead code, architecture) and `pnpm build`. A newer push to the same ref cancels the running check. Mutation testing does not run in CI (owner, #295); the mutation commands above run it by hand.
- Lead habit: push once per finished, reviewed unit of work, not after every fix.

`archive/` (v1) is outside every gate.
