// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/auth/client', () => ({
  sendMagicLink: vi.fn(async () => ({ ok: true })),
  startGoogle: vi.fn(async () => ({ ok: true }))
}));

import Login from './+page.svelte';

afterEach(() => cleanup());

describe('login page', () => {
  it('renders Google, email, and keep-signed-in — no password field', () => {
    render(Login, { props: { data: { error: null } } });
    expect(screen.getByRole('button', { name: /Google/i })).toBeTruthy();
    expect(screen.getByLabelText(/Email/i)).toBeTruthy();
    expect(screen.getByLabelText(/Keep me signed in/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/i)).toBeNull();
  });

  it('shows a check-your-email panel after requesting a magic link', async () => {
    render(Login, { props: { data: { error: null } } });
    await fireEvent.input(screen.getByLabelText(/Email/i), { target: { value: 'a@b.com' } });
    await fireEvent.click(screen.getByRole('button', { name: /magic link/i }));
    expect(await screen.findByText(/check your email/i)).toBeTruthy();
  });

  it('shows an error passed via load data', () => {
    render(Login, { props: { data: { error: 'Link expired' } } });
    expect(screen.getByText(/Link expired/i)).toBeTruthy();
  });
});
