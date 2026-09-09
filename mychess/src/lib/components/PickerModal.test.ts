// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import PickerModalHost from './PickerModal.test-host.svelte';

afterEach(() => {
  cleanup();
});

describe('PickerModal', () => {
  it('sets role="dialog" and aria-modal on the backdrop-adjacent panel', () => {
    render(PickerModalHost, { props: { heading: 'Test heading', closeLabel: 'Close', onclose: () => {} } });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('renders the heading and children content', () => {
    render(PickerModalHost, { props: { heading: 'Change Opening', closeLabel: 'Close', onclose: () => {} } });
    expect(screen.getByText('Change Opening')).toBeTruthy();
    expect(screen.getByTestId('picker-modal-child')).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });

  it('calls onclose when the backdrop is clicked', async () => {
    const onclose = vi.fn();
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose } });
    // The backdrop is the dialog's own outer container per the existing
    // pickers' pattern (click outside the inner stop-propagation div closes).
    await fireEvent.click(screen.getByTestId('picker-modal-backdrop'));
    expect(onclose).toHaveBeenCalled();
  });

  it('does not close when a click inside the panel is not on the backdrop', async () => {
    const onclose = vi.fn();
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose } });
    await fireEvent.click(screen.getByTestId('picker-modal-child'));
    expect(onclose).not.toHaveBeenCalled();
  });

  it('calls onclose on Escape', async () => {
    const onclose = vi.fn();
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose } });
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(onclose).toHaveBeenCalled();
  });

  it('moves focus into the modal on open', async () => {
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose: () => {} } });
    await tick();
    // Focus should land somewhere inside the dialog, not stay on <body>.
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('restores focus to the previously-focused element on close', async () => {
    // A real trigger button living outside the modal, focused before mount —
    // this is the part jsdom genuinely tracks (`document.activeElement`), so
    // this assertion is real, unlike anything relying on visual tab order.
    const trigger = document.createElement('button');
    trigger.textContent = 'open picker';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(PickerModalHost, {
      props: { heading: 'Heading', closeLabel: 'Close', onclose: () => {} }
    });
    await tick();
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('traps focus: Tab from the last focusable element wraps to the first', async () => {
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose: () => {} } });
    await tick();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const last = focusable[focusable.length - 1];
    const first = focusable[0];
    last.focus();
    expect(document.activeElement).toBe(last);
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('traps focus: Shift+Tab from the first focusable element wraps to the last', async () => {
    render(PickerModalHost, { props: { heading: 'Heading', closeLabel: 'Close', onclose: () => {} } });
    await tick();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const last = focusable[focusable.length - 1];
    const first = focusable[0];
    first.focus();
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
