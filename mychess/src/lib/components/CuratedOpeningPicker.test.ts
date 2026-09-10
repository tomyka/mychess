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
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'black', ecoCode: null, currentOpeningId: null, onclose: () => {} } });
    expect(screen.getByText('Sicilian: Najdorf')).toBeTruthy();
    expect(screen.queryByText('Anti-Sicilian: Alapin')).toBeNull();
    expect(screen.queryByText('Open Sicilian')).toBeNull();
  });

  // GitHub issue #205: the picker used to render a flat list, so a coach could
  // not tell whether an override existed or what it was, and re-picking the
  // same value looked identical to changing it.
  describe('current selection', () => {
    function rowFor(name: string | RegExp) {
      return screen.getByRole('button', { name });
    }

    it('marks Auto as current when no override is stored', () => {
      render(CuratedOpeningPicker, {
        props: { repId: 'r1', color: 'white', ecoCode: 'B22', currentOpeningId: null, onclose: () => {} }
      });
      expect(rowFor(/Auto — from the ECO code/).getAttribute('aria-current')).toBe('true');
      expect(rowFor('Anti-Sicilian: Alapin').getAttribute('aria-current')).toBeNull();
    });

    it('marks the stored override as current, and Auto as not', () => {
      render(CuratedOpeningPicker, {
        props: {
          repId: 'r1',
          color: 'white',
          ecoCode: 'B22',
          currentOpeningId: 'anti-sicilian-alapin-white',
          onclose: () => {}
        }
      });
      expect(rowFor('Anti-Sicilian: Alapin').getAttribute('aria-current')).toBe('true');
      expect(rowFor(/Auto — from the ECO code/).getAttribute('aria-current')).toBeNull();
    });

    // The stored column is null on almost every repertoire while the opening is
    // derived, so Auto has to say what it currently means or the coach is still
    // guessing.
    it('says what Auto currently resolves to', () => {
      render(CuratedOpeningPicker, {
        props: { repId: 'r1', color: 'white', ecoCode: 'B50', currentOpeningId: null, onclose: () => {} }
      });
      expect(screen.getByText(/currently Anti-Sicilian: Delayed Alapin/)).toBeTruthy();
    });

    it('says nothing extra when the ECO code resolves to no curated opening', () => {
      render(CuratedOpeningPicker, {
        props: { repId: 'r1', color: 'white', ecoCode: 'C60', currentOpeningId: null, onclose: () => {} }
      });
      expect(screen.queryByText(/currently/)).toBeNull();
    });
  });

  it('always shows the Auto option', () => {
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', ecoCode: null, currentOpeningId: null, onclose: () => {} } });
    expect(screen.getByText(/Auto — from the ECO code/)).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', ecoCode: null, currentOpeningId: null, onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });

  // The defect the coordinator flagged: the plan's original handleSubmit closed
  // the modal unconditionally, so a failed save looked identical to a
  // successful one. This pins the fix — same shape as OpeningPicker's own test
  // for the same interaction.
  it('keeps the modal open and shows an error when the update action fails, without closing', async () => {
    const onclose = vi.fn();
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', ecoCode: null, currentOpeningId: null, onclose } });

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
    render(CuratedOpeningPicker, { props: { repId: 'r1', color: 'white', ecoCode: null, currentOpeningId: null, onclose } });

    const callback = await capturedSubmitFns[0]();
    const update = vi.fn().mockResolvedValue(undefined);
    await callback({ result: { type: 'success', status: 200 }, update });

    expect(onclose).toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
