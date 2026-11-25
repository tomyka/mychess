'use client';

// Coach notes in training (#322, #338, R-174): the notes the domain gives a
// move (drillCoachNotes), and the panel's box that shows them. When a drill
// shows them is the drill state's rule: the learn pass with the move's
// arrow, a review once the move is answered, so a note never gives the
// answer away.
import type { RepertoireMove } from '@mychess/chess';
import {
  drillCoachNotes,
  type DrillCoachNote as DrillNote,
  type DrillRepertoire,
} from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { TrainingData } from '../../lib/training-data';
import { CoachNoteCard } from '../repertoire-view/coach-notes';

type Entry = TrainingData['entries'][number];

/** The entry as the domain's rule reads it. */
const drillRepertoire = (entry: Entry): DrillRepertoire =>
  entry.kind === 'own'
    ? { id: entry.id, kind: 'own' }
    : { id: entry.id, kind: 'assigned', coachName: entry.coachName };

/** The Coach notes on `move` of repertoire `repertoireId` (drillCoachNotes). */
export function coachNotesFor(
  data: Pick<TrainingData, 'entries' | 'coachNotes'>,
  repertoireId: string | undefined,
  move: RepertoireMove | undefined,
): readonly DrillNote[] {
  const entry = data.entries.find((e) => e.id === repertoireId);
  if (entry === undefined || move === undefined) return [];
  return drillCoachNotes(drillRepertoire(entry), move, data.coachNotes);
}

/** The Coach notes in the drill's panel, read-only, each named with its coach; nothing when there are none. */
export function DrillCoachNote({
  notes,
}: {
  readonly notes: readonly DrillNote[];
}): JSX.Element | null {
  const t = useTranslations();
  if (notes.length === 0) return null;
  return (
    <section
      role="note"
      aria-label={t('training.drill.coachNote')}
      className="flex flex-col gap-2"
    >
      {notes.map((note, i) => (
        <CoachNoteCard
          // A move's notes are fixed for the drill: the index is stable.
          key={i}
          label={t('coachNote.byCoach', { name: note.coachName })}
          text={note.text}
        />
      ))}
    </section>
  );
}
