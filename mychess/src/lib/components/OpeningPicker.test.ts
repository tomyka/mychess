// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import OpeningPicker from './OpeningPicker.svelte';

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
