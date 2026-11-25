import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { OnboardingState } from './actions';
import { OnboardingForm } from './onboarding-form';

const server = vi.hoisted(() => ({
  action:
    vi.fn<
      (previous: OnboardingState, form: FormData) => Promise<OnboardingState>
    >(),
}));

vi.mock('./actions', () => ({ completeOnboardingAction: server.action }));

const o = MESSAGES.onboarding;

function renderForm(
  displayName = 'Rūta Jonaitė',
  next: string | null = null,
): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <OnboardingForm displayName={displayName} next={next} />
    </NextIntlClientProvider>,
  );
}

const nameField = () => screen.getByLabelText<HTMLInputElement>(o.displayName);
const status = () => screen.getByRole('status');
const submit = () => {
  fireEvent.click(screen.getByRole('button', { name: o.submit }));
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
  it('welcomes the account with the name prefilled and its hint (R-81)', () => {
    renderForm('Ruta');
    expect(
      screen.getByRole('heading', { level: 1, name: o.title }),
    ).toBeDefined();
    expect(screen.getByText(o.intro)).toBeDefined();
    expect(nameField().value).toBe('Ruta');
    expect(nameField().getAttribute('aria-describedby')).toBe(
      screen.getByText(o.displayNameHint).id,
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('starts with an empty name when no provider gave one', () => {
    renderForm('');
    expect(nameField().value).toBe('');
  });

  it('sends only the typed name', async () => {
    renderForm();
    fireEvent.change(nameField(), { target: { value: 'Rūta' } });
    submit();
    await waitFor(() => {
      expect(server.action).toHaveBeenCalledTimes(1);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta' });
  });

  it('sends the return path along when there is one (R-81)', async () => {
    const next = `/k/${'A'.repeat(42)}_`;
    renderForm('Rūta', next);
    submit();
    await waitFor(() => {
      expect(server.action).toHaveBeenCalledTimes(1);
    });
    expect(submitted()).toEqual({ displayName: 'Rūta', next });
  });

  it('shows a refusal and marks the name field', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.blank' });
    renderForm('');
    submit();
    await waitFor(() => {
      expect(status().textContent).toBe(MESSAGES.displayName.blank);
    });
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toContain(status().id);
  });

  it('keeps what was typed after a refusal', async () => {
    server.action.mockResolvedValue({ refusal: 'displayName.tooLong' });
    renderForm();
    const long = 'a'.repeat(51);
    fireEvent.change(nameField(), { target: { value: long } });
    submit();
    await waitFor(() => {
      expect(status().textContent).toBe(MESSAGES.displayName.tooLong);
    });
    expect(nameField().value).toBe(long);
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
    const button = screen.getByRole('button', { name: o.submit });
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(true);
    });
    answer({});
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });
});
