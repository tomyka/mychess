import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { OnboardingState } from './actions';
import { OnboardingForm } from './onboarding-form';

const server = vi.hoisted(() => ({
  action:
    vi.fn<
      (previous: OnboardingState, form: FormData) => Promise<OnboardingState>
    >(),
}));

vi.mock('./actions', () => ({ completeOnboardingAction: server.action }));

const lt = MESSAGES.lt;
const en = MESSAGES.en;

function renderForm(
  displayName = 'Rūta Jonaitė',
  locale: 'lt' | 'en' = 'lt',
  next: string | null = null,
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <OnboardingForm displayName={displayName} locale={locale} next={next} />
    </NextIntlClientProvider>,
  );
}

const nameField = (label = lt.onboarding.displayName) =>
  screen.getByLabelText<HTMLInputElement>(label);
const languageOption = (label: string) =>
  screen.getByRole<HTMLInputElement>('radio', { name: label });
const status = () => screen.getByRole('status');
const submit = (label = lt.onboarding.submit) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
};

/** The form the action was last called with, as plain fields. */
function submitted(): Record<string, FormDataEntryValue> {
  const form = server.action.mock.lastCall?.[1];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

beforeEach(() => {
  server.action.mockReset().mockResolvedValue({});
});

describe('OnboardingForm', () => {
  it('welcomes the account with the name and language prefilled (R-81)', () => {
    renderForm();
    expect(
      screen.getByRole('heading', { level: 1, name: lt.onboarding.title }),
    ).toBeDefined();
    expect(nameField().value).toBe('Rūta Jonaitė');
    expect(languageOption(lt.language.lt).checked).toBe(true);
    expect(languageOption(lt.language.en).checked).toBe(false);
    expect(status().textContent).toBe('');
  });

  it('names each language in that language, on the English page too', () => {
    renderForm('Ruta', 'en');
    expect(
      screen.getByRole('heading', { level: 1, name: en.onboarding.title }),
    ).toBeDefined();
    expect(languageOption('Lietuvių').checked).toBe(false);
    expect(languageOption('English').checked).toBe(true);
  });

  it('starts with an empty name when no provider gave one', () => {
    renderForm('');
    expect(nameField().value).toBe('');
  });

  it('sends the name and the chosen language', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Rūta' } });
    fireEvent.click(languageOption(lt.language.en));
    submit();
    await waitFor(() => {
      expect(server.action).toHaveBeenCalledTimes(1);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta', locale: 'en' });
  });

  it('sends the return path along when there is one (R-81)', async () => {
    const next = `/k/${'A'.repeat(42)}_`;
    renderForm('Rūta', 'lt', next);
    submit();
    await waitFor(() => {
      expect(server.action).toHaveBeenCalledTimes(1);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta', locale: 'lt', next });
  });

  it('shows a refusal in the page language and marks the name field', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.blank' });
    renderForm('');
    submit();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.displayName.blank);
    });
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toContain(status().id);
  });

  it('keeps what was typed and chosen after a refusal', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.tooLong' });
    renderForm();
    const long = 'a'.repeat(51);
    fireEvent.change(nameField(), { target: { value: long } });
    fireEvent.click(languageOption(lt.language.en));
    submit();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.displayName.tooLong);
    });
    expect(nameField().value).toBe(long);
    expect(languageOption(lt.language.en).checked).toBe(true);
  });

  it('does not mark the name field for a language refusal', async () => {
    server.action.mockResolvedValue({ refusal: 'account.localeInvalid' });
    renderForm();
    submit();
    await waitFor(() => {
      expect(status().textContent).toBe(lt.account.localeInvalid);
    });
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });

  it('cannot send twice while saving', async () => {
    let answer: (state: OnboardingState) => void = () => undefined;
    server.action.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderForm();
    submit();
    const button = screen.getByRole('button', { name: lt.onboarding.submit });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(true);
    });
    answer({});
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });
});
