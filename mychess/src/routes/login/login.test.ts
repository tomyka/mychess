// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/auth/client', () => ({
  sendMagicLink: vi.fn(async () => ({ ok: true }))
}));

import Login from './+page.svelte';

afterEach(() => cleanup());

describe('login page', () => {
  it('renders a Google sign-in link, email, and keep-signed-in — no password field', () => {
    render(Login, { props: { data: { error: null } } });
    const googleLink = screen.getByRole('link', { name: /Google/i });
    expect(googleLink).toBeTruthy();
    expect(googleLink.getAttribute('href')).toBe('/auth/google?persist=1');
    expect(screen.getByLabelText(/Email/i)).toBeTruthy();
    expect(screen.getByLabelText(/Keep me signed in/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/i)).toBeNull();
  });

  it('reflects an unchecked keep-signed-in box in the Google link\'s persist param', async () => {
    render(Login, { props: { data: { error: null } } });
    await fireEvent.click(screen.getByLabelText(/Keep me signed in/i));
    const googleLink = screen.getByRole('link', { name: /Google/i });
    expect(googleLink.getAttribute('href')).toBe('/auth/google?persist=0');
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
