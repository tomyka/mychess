import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHashTarget } from './use-hash-target';

/** A section that `useHashTarget` brings into view as `#coaches`. */
function Section(): JSX.Element {
  const ref = useHashTarget<HTMLElement>('coaches');
  return (
    <section ref={ref} id="coaches">
      My coaches
    </section>
  );
}

const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();

/** The page scrolled `y` pixels down, as the reader or the browser left it. */
function scrolledTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

beforeEach(() => {
  scrolled.mockReset();
  // jsdom lays nothing out, so it has no scrollIntoView of its own.
  Element.prototype.scrollIntoView = scrolled;
  scrolledTo(0);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useHashTarget (#403)', () => {
  it('brings its section into view when the address names it and the page is still at the top', () => {
    // A hard reload of /settings#coaches: the browser's own hash scroll ran
    // against the loading skeleton, before the section streamed in.
    window.history.replaceState(null, '', '/settings#coaches');
    render(<Section />);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('leaves the page alone when the address names another place', () => {
    window.history.replaceState(null, '', '/settings#training');
    render(<Section />);
    window.history.replaceState(null, '', '/settings');
    render(<Section />);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('never fights a page the reader (or the browser) has already scrolled', () => {
    window.history.replaceState(null, '', '/settings#coaches');
    scrolledTo(240);
    render(<Section />);
    expect(scrolled).not.toHaveBeenCalled();
  });
});
