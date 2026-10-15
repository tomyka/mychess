# One account type; Coach is a capability

Status: accepted (2026-10-16, #226 Q25, Q26, Q34; owner-rulings R-11, R-13, R-39)

Every Account is a Player. Coach is a capability any Account can switch on, without approval; a Coach can still train and can have their own Coach. A Coach's access to a Player exists only through an accepted Coach link, and covers the Repertoires the Coach assigned plus the Player's imported games. The Player's own Repertoires stay private unless shared. Unlinking ends access immediately.

## Consequences

- Authorization is relationship-based (Coach link, Assignment), never based on an account type.
- Coach-of-coach chains are normal; no code may assume a Coach is not also someone's Player.
- FIDE title and trainer title are display badges from a linked FIDE ID, not access controls.

## Considered options

- Separate coach and player account types: rejected; coaches train too, and players become coaches.
- Approved or verified coaches: rejected; access is bounded by the Player accepting an Invite instead.
