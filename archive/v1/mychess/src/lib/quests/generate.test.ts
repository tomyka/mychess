import { describe, it, expect } from 'vitest';
import { QUEST_TEMPLATES, selectDailyQuests } from './generate';

describe('QUEST_TEMPLATES', () => {
  it('each template has required fields', () => {
    for (const t of QUEST_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.target).toBeGreaterThan(0);
    }
  });

  // The roster's whole invariant now that the unearnable three are gone: a
  // template is only worth showing if something reachable can advance it. Held
  // here as a list rather than a count so re-adding a template that no endpoint
  // writes to fails loudly instead of silently putting an impossible task back
  // on the dashboard.
  it('lists only templates a reachable endpoint actually increments', () => {
    expect(QUEST_TEMPLATES.map((t) => t.id)).toEqual(['review_cards']);
  });
});

describe('selectDailyQuests', () => {
  it('hands out the whole roster', () => {
    expect(selectDailyQuests('2024-01-15', 'player-uuid-1').map((q) => q.id)).toEqual(
      QUEST_TEMPLATES.map((t) => t.id)
    );
  });

  it('is deterministic for the same date + player', () => {
    const a = selectDailyQuests('2024-01-15', 'player-uuid-1');
    const b = selectDailyQuests('2024-01-15', 'player-uuid-1');
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });

  it('returns a fresh array, so a caller cannot mutate the roster', () => {
    selectDailyQuests('2024-01-15', 'p1').push({ id: 'x', description: 'x', target: 1 });
    expect(QUEST_TEMPLATES.map((t) => t.id)).toEqual(['review_cards']);
  });
});
