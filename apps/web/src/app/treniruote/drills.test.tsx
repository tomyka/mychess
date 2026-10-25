import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingData } from '../../server/training';
import type { DrillProps, FrameParts } from './drill';
import { LearnDrill } from './learn-drill';

// Until C6 builds it, the learn drill draws only the frame: the start
// position (no board of its own) and an empty panel.
const props = (frame: (parts: FrameParts) => JSX.Element): DrillProps => ({
  data: {
    mode: 'learn',
    entries: [],
    others: [],
    reviews: [],
    learned: [],
    learnedToday: 0,
    settings: { sessionSize: 20, newPerDay: 10 },
    nextDue: null,
    now: new Date(0),
  } satisfies TrainingData,
  sync: { record: vi.fn(), unsynced: 0, retry: vi.fn() },
  links: { back: '/', learn: '/treniruote?mode=learn' },
  frame,
});

describe('the learn drill placeholder', () => {
  it('draws the frame with no board of its own and an empty panel', () => {
    const frame = vi.fn((parts: FrameParts) => (
      <div>{parts.board ?? 'still'}</div>
    ));
    render(<LearnDrill {...props(frame)} />);
    expect(frame).toHaveBeenCalledWith({ panel: null });
    expect(screen.getByText('still')).toBeDefined();
  });
});
