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
  it('suggests asking a coach only when nothing is assigned either', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: [] } } });
    expect(screen.getByText(/Ask your coach to assign one/i)).toBeTruthy();
  });
  it('does not suggest asking a coach when repertoires are already assigned', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(screen.queryByText(/Ask your coach to assign one/i)).toBeNull();
  });

  it('shows a delete form with the repertoire id for each owned repertoire', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    expect((form.querySelector('input[name="rep_id"]') as HTMLInputElement).value).toBe('r1');
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('links an owned repertoire to its practice page, not a nonexistent /repertoires/[id] route', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const link = screen.getByText('French Defense').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/r1');
  });

  it('does not show a delete form in the assigned-by-coach section', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(document.querySelector('form[action="?/delete"]')).toBeNull();
  });
});
