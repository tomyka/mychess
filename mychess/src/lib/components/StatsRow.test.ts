// mychess/src/lib/components/StatsRow.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import StatsRow from './StatsRow.svelte';

afterEach(() => cleanup());

describe('StatsRow', () => {
  it('shows the streak count and fire emoji when streakDays > 0', () => {
    render(StatsRow, { props: { streakDays: 5 } });
    expect(screen.getByText('🔥 5')).toBeTruthy();
    expect(screen.getByText('Day streak')).toBeTruthy();
  });

  it('shows a dash when streakDays is 0', () => {
    render(StatsRow, { props: { streakDays: 0 } });
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('defaults streakDays to 0 when not provided', () => {
    render(StatsRow, { props: {} });
    expect(screen.getByText('–')).toBeTruthy();
  });
});
