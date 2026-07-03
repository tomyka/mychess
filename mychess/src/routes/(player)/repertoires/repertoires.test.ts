// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Repertoires from './+page.svelte';

afterEach(() => cleanup());

const assigned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];

describe('repertoires page', () => {
  it('shows the assigned-by-coach section when there are assignments', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(screen.getByText(/Assigned by your coach/i)).toBeTruthy();
    expect(screen.getByText('French Defense')).toBeTruthy();
  });
  it('hides the assigned section when there are none', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: [] } } });
    expect(screen.queryByText(/Assigned by your coach/i)).toBeNull();
  });
});
