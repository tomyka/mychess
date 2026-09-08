// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import OpeningPicker from './OpeningPicker.svelte';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';

// `use:enhance` from real SvelteKit needs client-side router/navigation context
// that isn't set up in this component-only jsdom render. Stub it so the test can
// drive the `submit` function passed to `use:enhance={handleSubmit}` directly,
// without depending on fetch/navigation internals — we just need to invoke the
// callback OpeningPicker returns with a synthetic failed ActionResult.
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

describe('OpeningPicker', () => {
  it('shows no opening results until the user types a query', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.queryByText(/Najdorf/i)).toBeNull();
  });

  it('always shows an Unclassified option', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.getByText('Unclassified')).toBeTruthy();
  });

  it('filters results as the user types', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'B90' } });
    expect(screen.getByText(/Najdorf/i)).toBeTruthy();
  });

  // Stands in for the plan's manual "switch locale in the running app" check
  // for the picker: the page itself is behind auth, but the locale-dependent
  // branch is entirely in this component (GitHub issue #158).
  it('renders the Lithuanian name for a result under the lt locale', async () => {
    overwriteGetLocale(() => 'lt');
    try {
      render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
      // Not by placeholder: under `lt` the placeholder is Lithuanian as well.
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'B90' } });

      expect(screen.getByText(/Siciliška gynyba, Naidorfo variantas/)).toBeTruthy();
      // The English name is gone from the label, but still posted as eco_name —
      // what gets stored stays English by design.
      expect(screen.queryByText(/Najdorf/)).toBeNull();
      expect(document.querySelector('input[name="eco_name"][value="Sicilian Defense: Najdorf Variation"]')).toBeTruthy();
    } finally {
      // Paraglide exposes no way to read the installed getter back, so restore
      // the base locale — which is what every other test in this file assumes.
      overwriteGetLocale(() => baseLocale);
    }
  });

  it('shows "No matches." for a query that matches nothing', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'zzz-no-such-opening' } });
    expect(screen.getByText('No matches.')).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(OpeningPicker, { props: { repId: 'r1', onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });

  it('keeps the modal open and shows an error when the update action fails, without closing', async () => {
    const onclose = vi.fn();
    render(OpeningPicker, { props: { repId: 'r1', onclose } });

    // Both forms (Unclassified + per-result) call use:enhance={handleSubmit} on mount,
    // so the mocked `enhance` above captured one `submit` fn per form. Grab the first
    // (the "Unclassified" form) and drive it as SvelteKit would: call it to get the
    // post-submit callback, then invoke that callback with a failed ActionResult.
    expect(capturedSubmitFns.length).toBeGreaterThan(0);
    const callback = await capturedSubmitFns[0]();
    const update = vi.fn().mockResolvedValue(undefined);
    await callback({ result: { type: 'failure', status: 400 }, update });

    expect(onclose).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    expect(screen.getByText(/could not update the opening/i)).toBeTruthy();
  });
});
