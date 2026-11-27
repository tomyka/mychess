import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type JSX } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './sheet';

/**
 * A button that opens a sheet with one field and a Close button. `mounted`
 * false takes the sheet away while it may be open; `withRef` hands the
 * button to the sheet as where focus goes back.
 */
function Opener({
  mounted = true,
  withRef = false,
}: {
  readonly mounted?: boolean;
  readonly withRef?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      {mounted ? (
        <Sheet
          open={open}
          onClose={close}
          titleId="sheet-title"
          {...(withRef ? { returnFocusRef: button } : {})}
        >
          <h2 id="sheet-title">A sheet</h2>
          <input aria-label="Field" />
          <button type="button" onClick={close}>
            Close
          </button>
        </Sheet>
      ) : null}
    </>
  );
}

const opener = (): HTMLElement => screen.getByRole('button', { name: 'Open' });

/** Opens the sheet from a focused button, then focuses the field in it. */
const openSheet = (): HTMLElement => {
  const button = opener();
  button.focus();
  fireEvent.click(button);
  screen.getByRole('textbox', { name: 'Field' }).focus();
  return button;
};

describe('Sheet', () => {
  it('shows nothing until it is opened, then a dialog named by its title', () => {
    render(<Opener />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Field' })).toBeNull();
    openSheet();
    expect(screen.getByRole('dialog', { name: 'A sheet' })).toBeDefined();
  });

  it('closes when the browser cancels it (Escape), focus back on the opener', () => {
    render(<Opener />);
    const button = openSheet();
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    // The holder closes it, not the browser behind its back.
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('tells the holder when the browser closes it by itself', () => {
    render(<Opener />);
    const button = openSheet();
    // As a close request without a cancel does (a second Escape, a back
    // gesture): the dialog closes and fires `close`.
    const dialog = screen.getByRole<HTMLDialogElement>('dialog');
    act(() => {
      dialog.close();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Field' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes from a button inside it, focus back on the opener', () => {
    render(<Opener />);
    const button = openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('gives focus back when it goes away while open', () => {
    const { rerender } = render(<Opener />);
    const button = openSheet();
    rerender(<Opener mounted={false} />);
    expect(document.activeElement).toBe(button);
  });

  it('gives focus to the button it is handed, which Safari does not focus on a click', () => {
    render(<Opener withRef />);
    // Nothing focused when it opens, as after a click in Safari.
    fireEvent.click(opener());
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(opener());
  });

  it('is a bottom sheet on a phone and a centred dialog from md, over a scrim', () => {
    render(<Opener />);
    openSheet();
    // The layout rule is the behaviour: pinned to the bottom edge under md
    // (over the tab bar, in the top layer), centred from md, the page
    // dimmed by the scrim token.
    const sheet = screen.getByRole('dialog').className.split(' ');
    expect(sheet).toEqual(
      expect.arrayContaining(['mt-auto', 'md:m-auto', 'backdrop:bg-scrim']),
    );
  });
});
