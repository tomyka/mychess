import type { RepertoireTraining } from '../../server/training';

/**
 * The player's training of the repertoire a page shows. Absent where the
 * viewer does not train it: a coach's view, or a paused assignment (R-46).
 */
export interface PanelTraining extends RepertoireTraining {
  readonly repertoireId: string;
}
