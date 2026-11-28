'use client';

import {
  useEffect,
  useRef,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

// The native modal <dialog>: it sits in the top layer, so on a phone it
// covers the fixed tab bar instead of sliding under it, the page behind it
// is inert, and the browser keeps Tab inside it. Preflight zeroes its
// margins, so the classes place it: pinned to the bottom edge under md, as
// a sheet, and centred from md. The safe-area padding keeps its last row
// above the home indicator. The top edge (card-edge, none in light) draws
// the sheet against the scrim in dark, where the surface barely differs.
const SHEET =
  'mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-card border-t border-card-edge bg-surface p-gutter pb-[calc(var(--spacing-gutter)+env(safe-area-inset-bottom))] text-fg shadow-sheet backdrop:bg-scrim md:m-auto md:max-w-lg md:rounded-card md:pb-gutter md:shadow-card';

/**
 * A bottom sheet on a phone, a dialog from md. The holder keeps whether it
 * is open. Escape (the browser's cancel) asks the holder to close it, and
 * a close the browser makes by itself is reported the same way. Closing,
 * or going away while open, gives focus back to `returnFocusRef` when
 * given (Safari does not focus a clicked button), else to whatever had
 * focus when it opened. Opening focuses `initialFocusRef` when given (the
 * field the sheet is for), else the browser's first focusable element.
 * Its content is rendered only while open, so what it showed (a link shown
 * once) goes with it.
 */
export function Sheet({
  open,
  onClose,
  titleId,
  returnFocusRef,
  initialFocusRef,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The id of the heading that names the sheet. */
  readonly titleId: string;
  /** Where focus goes back on closing: the button that opens the sheet. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes on opening, past what comes before it in the sheet. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}): JSX.Element {
  const dialog = useModal(open, { returnFocusRef, initialFocusRef });
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      className={SHEET}
    >
      {open ? children : null}
    </dialog>
  );
}

/** Focus back on `target`, when it is still something focusable. */
function focusBack(target: Element | null): void {
  if (target instanceof HTMLElement) target.focus();
}

/** Where focus goes on opening and back on closing. */
interface FocusRefs {
  readonly returnFocusRef: RefObject<HTMLElement | null> | undefined;
  readonly initialFocusRef: RefObject<HTMLElement | null> | undefined;
}

/**
 * Shows the dialog modally while `open`. Opening focuses the initial
 * element after showModal, whose own focusing would pick the first
 * focusable one. On closing, and on unmounting while open, focus goes back
 * to where it was sent from.
 */
function useModal(
  open: boolean,
  { returnFocusRef, initialFocusRef }: FocusRefs,
): RefObject<HTMLDialogElement | null> {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<Element | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (element === null || shown.current === open) return;
    shown.current = open;
    if (open) {
      returnTo.current = returnFocusRef?.current ?? document.activeElement;
      element.showModal();
      initialFocusRef?.current?.focus();
      return;
    }
    if (element.open) element.close();
    focusBack(returnTo.current);
  }, [open, returnFocusRef, initialFocusRef]);
  useEffect(
    () => () => {
      if (shown.current) focusBack(returnTo.current);
    },
    [],
  );
  return dialog;
}
