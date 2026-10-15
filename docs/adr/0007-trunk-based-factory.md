# Trunk-based agent factory with lead-only commits

Status: accepted (2026-10-16, #226 Q17, Q20, Q22, Q23; owner-rulings R-31, R-34, R-36, R-37)

v2 is built by an agent team (ten technical roles plus the lead) working trunk-based on `main`. Only the lead commits. Green CI deploys to staging automatically; production is promoted manually by the owner. Unattended backlog runs are allowed only for issues labelled both `size/small` and `auto-ok`.

## Consequences

- Role agents hand work to the lead rather than committing; the lead is the single integration point.
- Staging always reflects `main`; production never moves without the owner.
- Labels are load-bearing: `size/small` + `auto-ok` is the unattended-run contract, so labelling an issue is a permission decision.
- Decisions are recorded in `docs/CONTEXT.md`, `docs/adr/` and `docs/owner-rulings.md`, mirrored on GitHub issues.

## Considered options

- Automatic production deploys: rejected; the owner promotes.
- Unattended runs on any issue: rejected; limited to `size/small` + `auto-ok`.
