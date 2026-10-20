import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmedAction } from './confirmed-action';

const LABELS = {
  label: 'Atsieti',
  question: 'Atsieti nuo trenerio?',
  confirm: 'Taip, atsieti',
  cancel: 'Atšaukti',
};

function renderStep(action: (form: FormData) => Promise<void>): void {
  render(
    <ConfirmedAction
      action={action}
      fields={{ coachId: 'c-1' }}
      describedBy="coach-1"
      {...LABELS}
    />,
  );
}

const button = (name: string) => screen.getByRole('button', { name });

describe('ConfirmedAction', () => {
  it('asks before it acts', () => {
    const action = vi.fn(() => Promise.resolve());
    renderStep(action);
    expect(screen.queryByText(LABELS.question)).toBeNull();
    expect(screen.queryByRole('button', { name: LABELS.confirm })).toBeNull();
    expect(button(LABELS.label).getAttribute('aria-describedby')).toBe(
      'coach-1',
    );
    fireEvent.click(button(LABELS.label));
    expect(screen.getByText(LABELS.question)).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('moves focus to Cancel when it asks, and back to the button when cancelled', () => {
    renderStep(vi.fn(() => Promise.resolve()));
    button(LABELS.label).focus();
    fireEvent.click(button(LABELS.label));
    expect(document.activeElement).toBe(button(LABELS.cancel));
    fireEvent.click(button(LABELS.cancel));
    expect(document.activeElement).toBe(button(LABELS.label));
  });

  it('sends its fields once confirmed', async () => {
    const action = vi.fn<(form: FormData) => Promise<void>>(() =>
      Promise.resolve(),
    );
    renderStep(action);
    fireEvent.click(button(LABELS.label));
    fireEvent.click(button(LABELS.confirm));
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const form = action.mock.lastCall?.[0];
    expect(Object.fromEntries(form?.entries() ?? [])).toEqual({
      coachId: 'c-1',
    });
  });

  it('goes back on cancel without acting', () => {
    const action = vi.fn(() => Promise.resolve());
    renderStep(action);
    fireEvent.click(button(LABELS.label));
    fireEvent.click(button(LABELS.cancel));
    expect(screen.queryByText(LABELS.question)).toBeNull();
    expect(button(LABELS.label)).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('confirms in the danger colour unless the action only creates', () => {
    const action = vi.fn(() => Promise.resolve());
    renderStep(action);
    fireEvent.click(button(LABELS.label));
    expect(button(LABELS.confirm).className).toContain('bg-error');
    cleanup();
    render(
      <ConfirmedAction
        action={action}
        fields={{}}
        tone="primary"
        {...LABELS}
      />,
    );
    fireEvent.click(button(LABELS.label));
    expect(button(LABELS.confirm).className).toContain('bg-accent');
    expect(button(LABELS.confirm).className).not.toContain('bg-error');
  });
});
