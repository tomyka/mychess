# Assignments are live-linked, with Fork and Reconciliation

Status: accepted (2026-10-16, #226 Q3, Q28, Q29, Q31, Q41; owner-rulings R-16, R-20, R-21, R-23, R-40)

An Assignment gives a Player the Coach's Repertoire itself, not a copy: later Coach edits reach the Player. The Player may add only private Personal notes; changing or adding Moves requires a Fork, a Player-owned copy that no longer follows the Coach. When a Coach edits, each affected Player's training state is reconciled: unchanged Moves keep progress, new Moves go to learn, removed Moves leave review, a changed Move starts fresh, and the Player gets a "coach updated" notice. Group assignments are inherited by current and future members and removed on leaving (unless also assigned individually). On unlink the Coach loses access, the Player keeps progress and is offered a Fork.

## Consequences

- Training state is keyed to Moves of the Coach's Repertoire and must survive edits to it.
- Reconciliation runs for every Player and Group member the Repertoire is assigned to.
- A Fork carries training state (R-43). On unlink or leaving a Group with the Fork declined, the Repertoire disappears and its Reviews stay dormant; the Fork offer stays open for 30 days (R-44, R-45). A coach deleting their account auto-forks for players (R-49).

## Considered options

- Copy on assign: rejected; Coach fixes would never reach Players. Players may still Fork.
- Players adding or changing Moves on the live Repertoire: rejected; personal notes only, edits via Fork.
