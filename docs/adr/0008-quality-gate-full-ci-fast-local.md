# Quality gate: full in CI, fast locally

Status: accepted (2026-10-16, #226 Q19; owner-rulings R-33)

v2 adopts the sportbet quality kit wholesale (coverage 80, mutation, CRAP, knip, dependency-cruiser). CI enforces the full gate including mutation testing. Locally, the post-edit hook stays on and the Stop hook runs a fast gate without mutation.

## Consequences

- A change can pass locally and still fail CI on mutation score; CI is the authority.
- The local gate must stay fast enough not to be disabled, which is what happened to the sportbet hooks.

## Considered options

- Full gate including mutation in the Stop hook: rejected; the sportbet hooks were switched off locally for being too heavy.
