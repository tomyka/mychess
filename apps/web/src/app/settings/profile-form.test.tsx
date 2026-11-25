import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { ProfileState } from './actions';
import { ProfileForm } from './profile-form';

const server = vi.hoisted(() => ({
  action:
    vi.fn<(previous: ProfileState, form: FormData) => Promise<ProfileState>>(),
}));

vi.mock('./actions', () => ({ updateProfileAction: server.action }));

const p = MESSAGES.settings.profile;

function renderForm(): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ProfileForm displayName="Rūta Jonaitė" />
    </NextIntlClientProvider>,
  );
}

const nameField = () => screen.getByLabelText<HTMLInputElement>(p.displayName);
const status = () => screen.getByRole('status');
const save = () => {
  fireEvent.click(screen.getByRole('button', { name: p.submit }));
};

function submitted(): Record<string, FormDataEntryValue> {
  const form = server.action.mock.lastCall?.[1];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

beforeEach(() => {
  server.action.mockReset().mockResolvedValue({ saved: true });
});

describe('ProfileForm', () => {
  it('shows the current name', () => {
    renderForm();
    expect(
      screen.getByRole('heading', { level: 2, name: p.title }),
    ).toBeDefined();
    expect(nameField().value).toBe('Rūta Jonaitė');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('sends the changed name, then says it saved', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Rūta' } });
    save();
    await waitFor(() => {
      expect(status().textContent).toBe(p.saved);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta' });
    expect(server.action).toHaveBeenCalledTimes(1);
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a refusal, marks the name field and keeps what was typed', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.blank' });
    renderForm();
    fireEvent.change(nameField(), { target: { value: '  ' } });
    save();
    await waitFor(() => {
      expect(status().textContent).toBe(MESSAGES.displayName.blank);
    });
    expect(nameField().value).toBe('  ');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toBe(status().id);
  });

  it('cannot send twice while saving', async () => {
    let answer: (state: ProfileState) => void = () => undefined;
    server.action.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderForm();
    save();
    const button = screen.getByRole('button', { name: p.submit });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(true);
    });
    answer({ saved: true });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });
});
