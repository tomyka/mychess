// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import CuratedOpeningPicker from './CuratedOpeningPicker.svelte';

// Same stand-in as OpeningPicker.test.ts: real `use:enhance` needs client-side
// router/navigation context this component-only jsdom render doesn't have, so
// the mock captures the `submit` function passed to `use:enhance={handleSubmit}`
// and lets the test drive it directly with a synthetic ActionResult.
const capturedSubmitFns: Array<() => any> = [];
vi.mock('$app/forms', () => ({
  enhance: (_form: HTMLFormElement, submit: () => any) => {
    capturedSubmitFns.push(submit);
    return { destroy() {} };
  }
}));

afterEach(() => {
  cleanup();
  capturedSubmitFns.length = 0;
});

describe('CuratedOpeningPicker', () => {
  it('only offers openings matching the repertoire colour', () => {
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'black', onclose: () => {} } });
    expect(screen.getByText('Sicilian: Najdorf')).toBeTruthy();
    expect(screen.queryByText('Anti-Sicilian: Alapin')).toBeNull();
    expect(screen.queryByText('Open Sicilian')).toBeNull();
  });

  it('always shows the Auto option', () => {
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', onclose: () => {} } });
    expect(screen.getByText(/Auto — from the ECO code/)).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });

  // The defect the coordinator flagged: the plan's original handleSubmit closed
  // the modal unconditionally, so a failed save looked identical to a
  // successful one. This pins the fix — same shape as OpeningPicker's own test
  // for the same interaction.
  it('keeps the modal open and shows an error when the update action fails, without closing', async () => {
    const onclose = vi.fn();
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', onclose } });

    expect(capturedSubmitFns.length).toBeGreaterThan(0);
    const callback = await capturedSubmitFns[0]();
    const update = vi.fn().mockResolvedValue(undefined);
    await callback({ result: { type: 'failure', status: 500 }, update });

    expect(onclose).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    expect(screen.getByText(/could not update the opening/i)).toBeTruthy();
  });

  it('closes on a successful update', async () => {
    const onclose = vi.fn();
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', onclose } });

    const callback = await capturedSubmitFns[0]();
    const update = vi.fn().mockResolvedValue(undefined);
    await callback({ result: { type: 'success', status: 200 }, update });

    expect(onclose).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
