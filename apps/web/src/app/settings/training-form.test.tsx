import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
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

const t = MESSAGES.training.settings;

function renderForm(learnArrows = true): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TrainingForm
        settings={{ sessionSize: 20, newPerDay: 10, learnArrows }}
      />
    </NextIntlClientProvider>,
  );
}

const sessionField = () =>
  screen.getByLabelText<HTMLInputElement>(t.sessionSizeLabel);
const newField = () =>
  screen.getByLabelText<HTMLInputElement>(t.newPerDayLabel);
const arrowsBox = () =>
  screen.getByRole<HTMLInputElement>('checkbox', {
    name: t.learnArrowsLabel,
  });
const status = () => screen.getByRole('status');

function save(sessionSize: string, newPerDay: string): void {
  fireEvent.change(sessionField(), { target: { value: sessionSize } });
  fireEvent.change(newField(), { target: { value: newPerDay } });
  fireEvent.click(screen.getByRole('button', { name: t.submit }));
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
      screen.getByRole('heading', { level: 2, name: t.title }),
    ).toBeDefined();
    expect(sessionField().value).toBe('20');
    expect(newField().value).toBe('10');
    expect(sessionField().getAttribute('aria-describedby')).toContain(
      screen.getByText(t.sessionSizeHint).id,
    );
    expect(newField().getAttribute('aria-describedby')).toContain(
      screen.getByText(t.newPerDayHint).id,
    );
    expect(status().textContent).toBe('');
  });

  it('sends both limits, then says it saved', async () => {
    renderForm();
    save('40', '0');
    await waitFor(() => {
      expect(status().textContent).toBe(t.saved);
    });
    expect(submitted()).toEqual({
      sessionSize: '40',
      newPerDay: '0',
      learnArrows: 'on',
    });
    expect(sessionField().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the arrows setting, on when stored on, with its hint (R-205)', () => {
    renderForm();
    expect(arrowsBox().checked).toBe(true);
    expect(arrowsBox().getAttribute('aria-describedby')).toContain(
      screen.getByText(t.learnArrowsHint).id,
    );
  });

  it('is the settings section #training that training links to', () => {
    renderForm();
    expect(screen.getByRole('region', { name: t.title }).id).toBe('training');
  });

  it('shows the arrows setting off when stored off', () => {
    renderForm(false);
    expect(arrowsBox().checked).toBe(false);
  });

  it('sends no arrows setting once the box is cleared', async () => {
    renderForm();
    fireEvent.click(arrowsBox());
    save('20', '10');
    await waitFor(() => {
      expect(status().textContent).toBe(t.saved);
    });
    expect(submitted()).toEqual({ sessionSize: '20', newPerDay: '10' });
  });

  it('refuses a session of 9, marks that field and keeps what was typed', async () => {
    server.action.mockResolvedValue({
      refusal: 'training.settings.sessionSize',
    });
    renderForm();
    save('9', '10');
    await waitFor(() => {
      expect(status().textContent).toBe(t.sessionSize);
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
      expect(status().textContent).toBe(t.newPerDay);
    });
    expect(newField().getAttribute('aria-invalid')).toBe('true');
    expect(sessionField().getAttribute('aria-invalid')).toBeNull();
  });
});
