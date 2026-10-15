# Issue tracker

Work is tracked as GitHub issues in **`tomyka/mychess`** with the `gh` CLI.
`gh` infers the repo from the working directory. Skills that expect an issue
tracker (for example `mp-code-review` resolving `#123`) read this file. When
to file and close issues is in `CLAUDE.md` > Workflow.

```bash
gh issue view <n> --comments
gh issue list --state open --label size/small
gh issue create --title "..." --label size/small,area/chess,role/chess-dev --milestone "M1 Core loop"
```

## Structure

- **Epic** (`epic`): a body with goal, scope and non-goals; its tasks are
  GitHub **sub-issues** (`gh api -X POST repos/tomyka/mychess/issues/<epic>/sub_issues -F sub_issue_id=<issue id>`).
- **Milestones**: `M1 Core loop`, `M2 Coaching`, `M3 Ecosystem` (ruling Q11).
- A task body starts with `Part of #<epic>.` and ends with acceptance
  criteria. The closing comment cites the commit range and CI result.

## Labels

| Label | Meaning |
| --- | --- |
| `epic` | groups tasks as sub-issues |
| `size/small` | self-contained, implementation-ready |
| `size/large` | brainstorm -> spec -> plan before code |
| `area/*` | chess, training, coach, repertoire, i18n, integrations, infra, auth, ux |
| `persona/*` | coach, u1400, 1400-2000, 2000plus: which persona journey it affects or came from |
| `role/*` | the agent role that owns it (lead, architect, backend-dev, web-dev, qa, security-reviewer, devops, chess-dev, ux-designer, i18n-content, integrations-dev) |
| `auto-ok` | an unattended run may take it (only with `size/small`; set by a human) |
| `blocked` | waiting on something outside the issue; the comment says what |
| `kickoff` | the v2 kickoff epic (#225) |
| `archived-v1` | v1 issue, closed at the restart |

Commit messages reference the issue: `feat(chess): position keys (#241)`.
