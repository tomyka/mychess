# mychess

Opening training for Lithuanian chess players: players learn and review opening repertoires by spaced repetition, and coaches assign repertoires, monitor progress and talk to their players. Single context. Rulings behind these terms are in [owner-rulings.md](owner-rulings.md).

## Language

### People and links

**Account**:
One signed-in person. Every account is a Player; there is no separate coach account.
_Avoid_: User (in domain talk), profile (for the Account itself), coach account, student account

**Player**:
An Account in its role as someone who trains. Every Account is a Player, including every Coach.
_Avoid_: Student, learner, trainee

**Coach**:
A capability an Account switches on that lets it link Players, assign Repertoires and see their progress. A Coach is still a Player and may have Coaches of their own.
_Avoid_: Trainer (reserved for the FIDE trainer title badge), teacher, coach role/account

**Display name**:
The name an Account shows to others (Coaches, Group members, thread participants): trimmed, never blank, at most 50 characters.
_Avoid_: Username, nickname, handle

**Coach link**:
The accepted relationship between one Coach and one Player that grants the Coach access to that Player. A Player may have several Coach links; ending one (unlinking) removes the Coach's access immediately.
_Avoid_: Connection, follow, relationship, membership

**Invite**:
A link or code a Coach issues that, when a Player accepts it, creates a Coach link (and optionally Group membership).
_Avoid_: Referral, join code

**Group**:
A Coach's named set of linked Players, used to assign to and message several Players at once. Belongs to one Coach.
_Avoid_: Class, team, club (clubs are a separate, post-MVP concept)

**Profile**:
An Account's display name and language, the part a person edits in settings and on onboarding (R-91). Never the Account itself.
_Avoid_: Account settings (in domain talk), user profile

**Provider link**:
A sign-in method other than the magic link (Google or Lichess) linked to an Account. Created at sign-up or from settings while signed in; never by matching emails (R-69).
_Avoid_: Connection, social account, OAuth account

**Admin**:
The owner's operator capability: disabling Accounts, publishing Starter repertoires, triggering integration imports, viewing usage, all recorded in an audit log. Not a Coach power.
_Avoid_: Moderator, superuser

### Repertoires

**Repertoire**:
A Player's or Coach's prepared moves for one side (White or Black), organised into Chapters. An Account may own several Repertoires for the same side.
_Avoid_: Opening (an opening is a Chapter's subject, not the repertoire), course, study

**Side**:
The colour a Repertoire is played from: White or Black. Fixed per Repertoire.
_Avoid_: Colour (in prose fine), perspective

**Chapter**:
A named part of a Repertoire covering one opening (named from the šachmatai.lt taxonomy).
_Avoid_: Section, study chapter, folder

**PGN game**:
One game in an uploaded PGN file. On import each valid PGN game becomes one Chapter (R-63, R-64); a broken one is listed as skipped by its 1-based number in the file. Code inside `packages/chess/src/pgn/` may say "game" for it.
_Avoid_: Game (outside PGN import code), chapter (before import)

**Answer**:
The single own-side Move a Repertoire plays in a Position. A Repertoire has at most one answer per Position; a second answer belongs in another Repertoire (R-54) and is refused or skipped on import (`repertoire.secondAnswer`, `pgn.secondAnswer`).
_Avoid_: Reply (that is the opponent's Move), choice

**Position**:
A chess position as it arises in a Repertoire, independent of the move order that reached it.
_Avoid_: Node, FEN (as a domain word)

**Position key**:
The identity of a Position: two move orders reaching the same Position share one Position key.
_Avoid_: FEN (as an identity), hash

**Move** (repertoire move):
One edge of a Repertoire: from a Position, the move the Repertoire plays or expects. Own-side Moves (in code and specs: **player moves**, `isPlayerMove`) are the ones a Player is drilled on; opponent Moves are the replies the Repertoire prepares against.
_Avoid_: Ply (fine as a count), node, variation (a Move is not a line)

**Line**:
A path of Moves from a Chapter's starting Position to a leaf, or to a Move that returns to a Position already on the path; that Move ends the line and belongs to it (R-79). The main line follows the first Move added at each Position. A prose and reporting unit (progress per line, mastery of a line), not the unit of storage or scheduling.
_Avoid_: Variation (retired v1 identity unit)

**Transposition**:
Two different move orders in a Repertoire reaching the same Position key, which therefore merge into one Position.
_Avoid_: Duplicate, merge (as a noun)

**Starter repertoire**:
An owner-approved Repertoire for a Tier, published by an Admin, that a Player can take as a starting point.
_Avoid_: Template, default repertoire, course

### Assignment and ownership

**Assignment**:
A Coach giving a Repertoire to a Player or a Group, live-linked: the Player trains the Coach's Repertoire and sees the Coach's later edits. May carry a deadline. A Group assignment applies to current and future members while they remain in the Group.
_Avoid_: Copy, share, subscription

**Fork**:
A Player's personal, editable copy of an assigned Repertoire, cut off from the Coach's later edits. The only way for a Player to change or add Moves to something they were assigned.
_Avoid_: Clone, copy, duplicate

**Comment**:
Text on a Move of a Repertoire, from PGN or written in the builder. It belongs to the Repertoire: it is exported with it and seen by whoever may see the Repertoire (R-102, one paragraph per R-105). On a Coach's own Repertoire it is a Coach note.
_Avoid_: Annotation, note (a Personal note is private)

**Personal note**:
A Player's private note on a Move or Position of any Repertoire they train, including a live-linked one. Never visible to the Coach.
_Avoid_: Annotation, comment (a Comment belongs to the Repertoire)

**Coach note**:
A Coach's note on a Move of a Repertoire they own, shown to Players they assigned it to; or on a Repertoire a Player shared with them, shown read-only to that Player with the Coach's name (R-42, R-107).
_Avoid_: Annotation, comment (a Comment belongs to the Repertoire; discussion is a Thread)

**Reconciliation**:
Carrying a Player's training state across a change to a live-linked Repertoire: unchanged Moves keep their state, new Moves become to-learn, removed Moves leave review, a changed Move starts fresh. Followed by a "coach updated" Notification.
_Avoid_: Sync, migration, re-upload

### Training

**Learn pass**:
The first encounter with a Move: shown with arrows, then retested blind. A Move enters Review only after its Learn pass.
_Avoid_: Practice, lesson, teach mode

**Review**:
The spaced-repetition schedule for one own-side Move a Player has learned, one per (Player, Repertoire Move). Also the session in which due Reviews are drilled.
_Avoid_: Card (implementation word), practice pool, drill (fine as a verb)

**Due**:
A Review whose scheduled time has arrived, so it belongs in the next review session.
_Avoid_: Overdue (unless meaning past due by a stated margin), pending

**Lapse**:
A failed Review: the Player played a wrong Move in a drill, or a Player mistake in a real game was detected. A Lapse makes the Move Due now and shortens its schedule.
_Avoid_: Miss, error, demotion

**Free play**:
A second training mode where the Player plays against their Repertoire from the start rather than drilling Due Moves.
_Avoid_: Sparring, practice

### Real games

**Imported game**:
A real game of a Player brought in from a linked Lichess or Chess.com account. Visible to the Player's Coaches.
_Avoid_: Game (unqualified, ambiguous with drills)

**Deviation**:
The first point where an Imported game leaves a Repertoire. Two kinds:
- **Player mistake**: the Player chose a Move other than the Repertoire's. Causes a Lapse and a flag on the Coach dashboard.
- **Opponent left book**: the opponent played a Move the Repertoire does not prepare. Produces a suggestion to add a line from the explorer.
_Avoid_: Error, blunder, out-of-book (unqualified)

### Coaching

**Goal**:
A target a Coach or Player sets for a Player. Three kinds:
- **Habit goal**: a training-frequency target (for example, review every day).
- **Mastery goal**: a Line or Chapter mastered by a date.
- **Results goal**: no Player mistake Deviations in the next N Imported games.
_Avoid_: Target, objective, quest (v1 gamification)

**Thread**:
A conversation. Three kinds: a 1:1 thread between a Coach and a linked Player, a group thread for a Group, and a move comment thread attached to a Move or Position.
_Avoid_: Chat, conversation, DM

**Notification**:
An in-app notice to an Account about something that happened (new Assignment, coach update, message, goal event).
_Avoid_: Alert, message (a message lives in a Thread)

**Digest**:
A daily email summarising an Account's unread Notifications. On by default; the Account can opt out.
_Avoid_: Newsletter, summary email

**Weak spot**:
A Move or Line where a Player keeps lapsing, surfaced on the Coach dashboard.
_Avoid_: Problem area, blunder

### Product structure

**Tier**:
A rating band (0-1400, 1400-2000, 2000+) used as a QA persona and to pick soft defaults (suggested depth, Starter repertoire). Never gates a feature.
_Avoid_: Level, band (retired v1 term), plan

**Entitlement**:
What an Account is allowed to use on the commercial side. Everything is free in the MVP; Entitlement is the seam where coach subscriptions will attach.
_Avoid_: Plan, tier (a Tier is a rating band), permission

**Milestone**:
One of the three MVP delivery stages: M1 Core loop, M2 Coaching, M3 Ecosystem.
_Avoid_: Phase, release, sprint

## Relationships

- An **Account** is always a **Player**; it may also have the **Coach** capability and the **Admin** capability.
- A **Coach link** joins one **Coach** to one **Player**; it is created when the Player accepts an **Invite**. A Player may have many Coach links.
- A **Group** belongs to one **Coach** and contains Players the Coach is linked to.
- A **Repertoire** has one **Side**, one owning Account, and many **Chapters**. Its **Moves** connect **Positions**, identified by **Position key**, so **Transpositions** merge.
- An **Assignment** links one Repertoire to a Player or a Group, live. A **Fork** turns an Assignment into a Player-owned Repertoire.
- Each own-side **Move** a Player trains has a **Learn pass** and then one **Review**, which becomes **Due** on schedule and records **Lapses**.
- A Coach editing an assigned Repertoire triggers **Reconciliation** for every affected Player and a **Notification**.
- An **Imported game** may produce one **Deviation**; a Player mistake Deviation causes a **Lapse**.
- A **Goal** is set by a Coach or the Player for one Player; a **Results goal** is measured over Imported games.
- **Notifications** roll up into the daily **Digest**.

## Visibility

- A Coach sees everything about the Repertoires they assigned to a Player, and that Player's Imported games.
- A Player's own Repertoires (built, imported or forked) are private unless the Player shares them.
- **Personal notes** are visible only to their author.
- Unlinking ends a Coach's access immediately; the Player keeps their progress and is offered a Fork.

## Flagged ambiguities (resolved where marked R-n)

- **"Review"** is both the per-Move schedule and the drilling session. Kept deliberately; if it causes confusion, rename the session "review session".
- **"Line"** is used for progress and Mastery goals, but storage and scheduling are per Move. Mastered = every Move learned and FSRS retrievability >= 90% today (R-56).
- **Same Move in two Repertoires** (for example, two Coaches assigning overlapping openings): one Review per Player, position and Move (R-53); different answers in the same position are trained in context (R-54).
- **"Shared"** for a private Repertoire means shared with chosen linked Coaches, read-only with progress (R-42).
- **Fork and training state**: a Fork keeps the Player's Reviews, since Reviews belong to the Player, not the Repertoire (R-43, R-53).
- **"Trainer"** collides with the FIDE trainer title; use Coach for the capability and "FIDE trainer title" for the badge.
- **"Tier"** must not be used for Entitlement or subscription levels.

## Retired v1 terms

These come from v1 (`archive/v1/mychess/CONTEXT.md`) and are not used in v2. FSRS per Move replaced the v1 mastery model.

- **Learn unit**: replaced by the per-Move **Learn pass**.
- **Band** (Bronze/Silver/Gold/Platinum): retired; there is no depth gating. Do not confuse with **Tier**.
- **Practice pool** / **Practice**: replaced by **Review** (FSRS schedule).
- **Variation** (as the identified, addressable unit): replaced by **Move** for storage and scheduling; use **Line** in prose.
- **Solved / learned / mastered plies**: replaced by Review state.
- **Attempt**: no longer a domain unit; a drill outcome is either a pass or a **Lapse**.
- **Mastery** (as the name of the v1 teaching module): retired; "mastery" now only appears in **Mastery goal**.
- **Student**: use **Player**.
- Kept with a new meaning: **Repertoire** (now one Side, many Chapters, position-keyed), **Chapter** (now one opening), **Reconciliation** (now triggered by any Coach edit to a live-linked Repertoire, not only chapter removal).
