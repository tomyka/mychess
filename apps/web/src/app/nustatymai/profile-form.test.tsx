import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { ProfileState } from './actions';
import { ProfileForm } from './profile-form';

const server = vi.hoisted(() => ({
  action:
    vi.fn<(previous: ProfileState, form: FormData) => Promise<ProfileState>>(),
}));

vi.mock('./actions', () => ({ updateProfileAction: server.action }));

const lt = MESSAGES.lt;
const en = MESSAGES.en;

function renderForm(locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ProfileForm displayName="Rūta Jonaitė" locale={locale} />
    </NextIntlClientProvider>,
  );
}

const nameField = () =>
  screen.getByLabelText<HTMLInputElement>(lt.settings.profile.displayName);
const languageOption = (label: string) =>
  screen.getByRole<HTMLInputElement>('radio', { name: label });
const status = () => screen.getByRole('status');
const save = () => {
  fireEvent.click(
    screen.getByRole('button', { name: lt.settings.profile.submit }),
  );
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
  it('shows the current name and language', () => {
    renderForm();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: lt.settings.profile.title,
      }),
    ).toBeDefined();
    expect(nameField().value).toBe('Rūta Jonaitė');
    expect(languageOption(lt.language.lt).checked).toBe(true);
    expect(status().textContent).toBe('');
  });

  it('names the languages in their own language on the English page', () => {
    renderForm('en');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: en.settings.profile.title,
      }),
    ).toBeDefined();
    expect(languageOption('English').checked).toBe(true);
    expect(languageOption('Lietuvių').checked).toBe(false);
  });

  it('sends the changed name and language, then says it saved', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Rūta' } });
    fireEvent.click(languageOption(lt.language.en));
    save();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.settings.profile.saved);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta', locale: 'en' });
    expect(server.action).toHaveBeenCalledTimes(1);
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a refusal, marks the name field and keeps what was typed', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.blank' });
    renderForm();
    fireEvent.change(nameField(), { target: { value: '  ' } });
    save();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.displayName.blank);
    });
    expect(nameField().value).toBe('  ');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toBe(status().id);
  });

  it('does not mark the name field for a language refusal', async () => {
    server.action.mockResolvedValue({ refusal: 'account.localeInvalid' });
    renderForm();
    save();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.account.localeInvalid);
    });
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
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
    const button = screen.getByRole('button', {
      name: lt.settings.profile.submit,
    });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(true);
    });
    answer({ saved: true });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });
});
