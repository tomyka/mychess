/** The repertoire the Repertoire screen and its actions are about. */
export interface Repertoire {
  readonly id: string;
  readonly name: string;
}

/** How many players have it by assignment, whom a delete leaves a copy (R-131). */
export interface Holders {
  readonly assignedPlayers?: number | undefined;
}
