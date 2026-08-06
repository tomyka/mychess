import { describe, it, expect } from 'vitest';
import { QUEST_TEMPLATES, selectDailyQuests } from './generate';

describe('QUEST_TEMPLATES', () => {
  it('has exactly 4 templates', () => {
    expect(QUEST_TEMPLATES).toHaveLength(4);
  });

  it('each template has required fields', () => {
    for (const t of QUEST_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.target).toBeGreaterThan(0);
    }
  });
});

describe('selectDailyQuests', () => {
  it('returns exactly 3 quests', () => {
    const quests = selectDailyQuests('2024-01-15', 'player-uuid-1');
    expect(quests).toHaveLength(3);
  });

  it('is deterministic for same date + player', () => {
    const a = selectDailyQuests('2024-01-15', 'player-uuid-1');
    const b = selectDailyQuests('2024-01-15', 'player-uuid-1');
    expect(a.map(q => q.id)).toEqual(b.map(q => q.id));
  });

  it('quest ids are unique within one set', () => {
    const quests = selectDailyQuests('2024-01-15', 'player-uuid-1');
    const ids = quests.map(q => q.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('varies between different player ids', () => {
    const a = selectDailyQuests('2024-01-15', 'player-uuid-1');
    const b = selectDailyQuests('2024-01-15', 'player-uuid-99');
    // Very likely different with 4 choose 3 possibilities
    expect(a.map(q => q.id).join()).not.toEqual(b.map(q => q.id).join());
  });
});
