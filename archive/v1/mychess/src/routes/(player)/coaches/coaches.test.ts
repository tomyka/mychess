// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Coaches from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  coaches: [],
  pending: [],
  findResults: [],
  search: ''
};

describe('coaches page', () => {
  it('shows active coaches', () => {
    render(Coaches, {
      props: {
        data: { ...baseData, coaches: [{ id: 'r1', other: { id: 'c1', display_name: 'Coach Ana' } }] },
        form: null
      }
    });
    expect(screen.getByText('Coach Ana')).toBeTruthy();
  });

  it('shows an Accept button for a request sent to me, not by me', () => {
    render(Coaches, {
      props: {
        data: {
          ...baseData,
          pending: [{ id: 'r2', sentByMe: false, other: { id: 'c2', display_name: 'Coach Ben' } }]
        },
        form: null
      }
    });
    expect(screen.getByText('Accept')).toBeTruthy();
  });

  it('shows "awaiting response" instead of Accept for a request I sent', () => {
    render(Coaches, {
      props: {
        data: {
          ...baseData,
          pending: [{ id: 'r3', sentByMe: true, other: { id: 'c3', display_name: 'Coach Cid' } }]
        },
        form: null
      }
    });
    expect(screen.getByText(/awaiting response/i)).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('shows a form error message when present', () => {
    render(Coaches, { props: { data: baseData, form: { error: 'You already sent a request.' } } });
    expect(screen.getByText('You already sent a request.')).toBeTruthy();
  });
});
