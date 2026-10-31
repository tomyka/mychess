# Hosting: production on an Oracle VM, sportbet_new's pipeline

Status: accepted (2026-10-31, #310; owner-rulings R-164, R-165, R-166). Supersedes ADR 0009.

Production runs on one Oracle Cloud A1 VM (arm64, 1 OCPU, 6 GB), formerly
sportbet-ci and now mychess's alone: Caddy for TLS, the app as one Docker
image, Postgres in a container. CI copies sportbet_new's graph: the quality
gate, one image built and scanned, the E2E suite run against that image,
and a deploy of those bytes with a pre-deploy dump, migration, swap,
release check and rollback. Build and test jobs run on GitHub-hosted
runners; the deploy job runs on a self-hosted runner on the VM. There is no
staging: a green `main` deploys to production.

## Consequences

- Scheduled work runs as systemd timers on the VM calling bearer-protected
  routes (the rate-limit prune first).
- Production data lives on one host; a nightly dump with a restore test is
  copied off the host to OCI Object Storage.
- The owner no longer promotes; the rollback button redeploys an earlier
  green commit.
- Persona testing runs locally against the persona seeds.

## Considered options

- Vercel production with Neon (ADR 0009): replaced at the owner's request.
- Fully self-hosted CI as sportbet_new: rejected for a public repository,
  whose hosted minutes are free and whose runners would face fork code.
- Keeping Vercel staging beside the VM: rejected, as sportbet_new's
  decision 16.
