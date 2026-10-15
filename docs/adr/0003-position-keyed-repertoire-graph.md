# Repertoires are position-keyed graphs

Status: accepted (2026-10-16, #226 Q27; owner-rulings R-19)

A Repertoire is one Side, split into Chapters by opening, and stored as a graph of Moves between Positions identified by Position key, so transpositions merge into one Position. An Account may own several Repertoires per Side.

## Consequences

- Moves, not Lines, are the unit of storage, notes, comments and scheduling (see ADR 0004). Lines are derived for display and reporting.
- Importing PGN means mapping move sequences onto Position keys; two lines reaching the same Position share everything after it.
- A Chapter is a grouping over the graph, not a separate tree. How a Position reachable from two Chapters counts in Chapter-level stats is open (owner-rulings Open question 8).

## Considered options

- Move-sequence trees per line or per Chapter (v1's variation enumeration): rejected; transpositions would duplicate drills and progress.
- One Repertoire per Side per Account: rejected; Players with several Coaches or several systems need more than one.
