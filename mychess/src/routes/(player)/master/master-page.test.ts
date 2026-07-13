// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Master from './+page.svelte';

afterEach(() => cleanup());

describe('master page', () => {
  it('prompts a guest to sign in when no account is available', () => {
    render(Master, { props: { data: { needsAccount: true } } });
    expect(screen.getByText(/Sign in to train/i)).toBeTruthy();
  });

  it('shows the empty-pool message when the player has no moves to master', () => {
    render(Master, {
      props: {
        data: {
          needsAccount: false,
          masterMoves: [],
          bookMoveMap: {},
          boardPrefs: undefined
        }
      }
    });
    expect(screen.getByText(/No moves to master yet/i)).toBeTruthy();
  });
});
