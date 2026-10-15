// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Students from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  students: [],
  pending: [],
  findResults: [],
  search: ''
};

describe('coach students page', () => {
  it('shows active students, linked to their coach/players detail page', () => {
    render(Students, {
      props: {
        data: { ...baseData, students: [{ id: 'r1', other: { id: 'p1', display_name: 'Player Pat' } }] },
        form: null
      }
    });
    const link = screen.getByRole('link', { name: 'Player Pat' });
    expect(link.getAttribute('href')).toBe('/coach/players/p1');
  });

  it('shows an Accept button for a request received, not sent', () => {
    render(Students, {
      props: {
        data: { ...baseData, pending: [{ id: 'r2', sentByMe: false, other: { id: 'p2', display_name: 'Player Quinn' } }] },
        form: null
      }
    });
    expect(screen.getByText('Accept')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(Students, { props: { data: baseData, form: { error: 'No player selected' } } });
    expect(screen.getByText('No player selected')).toBeTruthy();
  });
});
