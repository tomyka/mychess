import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * findBy* and waitFor give up after 1 s by default. The full gate runs every
 * suite at once on one machine, and transitions then settle later than that,
 * so tests that wait correctly still timed out. 3 s stays under vitest's 5 s
 * test timeout.
 */
configure({ asyncUtilTimeout: 3000 });

/*
 * jsdom has <dialog> and its `open` attribute but not showModal() or
 * close(). These stand in for them as far as a test can see: open shows
 * the dialog, close hides it and fires `close`. Escape and the top layer
 * stay the browser's (E2E). A test file in the node environment has no
 * DOM at all.
 */
if (
  'HTMLDialogElement' in globalThis &&
  !('showModal' in HTMLDialogElement.prototype)
) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement): void {
      this.open = true;
    },
    close(this: HTMLDialogElement): void {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
}

afterEach(cleanup);
