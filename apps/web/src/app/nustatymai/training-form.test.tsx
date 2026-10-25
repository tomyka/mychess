import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { TrainingSettingsState } from './actions';
import { TrainingForm } from './training-form';

const server = vi.hoisted(() => ({
  action:
    vi.fn<
      (
        previous: TrainingSettingsState,
        form: FormData,
      ) => Promise<TrainingSettingsState>
    >(),
}));

vi.mock('./actions', () => ({ updateTrainingSettingsAction: server.action }));

const lt = MESSAGES.lt.training.settings;

function renderForm(locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <TrainingForm settings={{ sessionSize: 20, newPerDay: 10 }} />
    </NextIntlClientProvider>,
  );
}

const sessionField = () =>
  screen.getByLabelText<HTMLInputElement>(lt.sessionSizeLabel);
const newField = () =>
  screen.getByLabelText<HTMLInputElement>(lt.newPerDayLabel);
const status = () => screen.getByRole('status');

function save(sessionSize: string, newPerDay: string): void {
  fireEvent.change(sessionField(), { target: { value: sessionSize } });
  fireEvent.change(newField(), { target: { value: newPerDay } });
  fireEvent.click(screen.getByRole('button', { name: lt.submit }));
}

function submitted(): Record<string, FormDataEntryValue> {
  const form = server.action.mock.lastCall?.[1];
  if (form === undefined) throw new Error('the action was not called');
  return Object.fromEntries(form.entries());
}

beforeEach(() => {
  server.action.mockReset().mockResolvedValue({ saved: true });
});

describe('TrainingForm (R-62, R-146)', () => {
  it('shows the current limits, with their ranges', () => {
    renderForm();
    expect(
      screen.getByRole('heading', { level: 2, name: lt.title }),
    ).toBeDefined();
    expect(sessionField().value).toBe('20');
    expect(newField().value).toBe('10');
    expect(sessionField().getAttribute('aria-describedby')).toContain(
      screen.getByText(lt.sessionSizeHint).id,
    );
    expect(newField().getAttribute('aria-describedby')).toContain(
      screen.getByText(lt.newPerDayHint).id,
    );
    expect(status().textContent).toBe('');
  });

  it('labels the fields in English too', () => {
    renderForm('en');
    expect(
      screen.getByLabelText(MESSAGES.en.training.settings.sessionSizeLabel),
    ).toBeDefined();
  });

  it('sends both limits, then says it saved', async () => {
    renderForm();
    save('40', '0');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.saved);
    });
    expect(submitted()).toEqual({ sessionSize: '40', newPerDay: '0' });
    expect(sessionField().getAttribute('aria-invalid')).toBeNull();
  });

  it('refuses a session of 9, marks that field and keeps what was typed', async () => {
    server.action.mockResolvedValue({
      refusal: 'training.settings.sessionSize',
    });
    renderForm();
    save('9', '10');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.sessionSize);
    });
    expect(sessionField().value).toBe('9');
    expect(sessionField().getAttribute('aria-invalid')).toBe('true');
    expect(sessionField().getAttribute('aria-describedby')).toContain(
      status().id,
    );
    expect(newField().getAttribute('aria-invalid')).toBeNull();
  });

  it('refuses 51 new moves a day and marks that field', async () => {
    server.action.mockResolvedValue({ refusal: 'training.settings.newPerDay' });
    renderForm();
    save('20', '51');
    await waitFor(() => {
      expect(status().textContent).toBe(lt.newPerDay);
    });
    expect(newField().getAttribute('aria-invalid')).toBe('true');
    expect(sessionField().getAttribute('aria-invalid')).toBeNull();
  });
});
