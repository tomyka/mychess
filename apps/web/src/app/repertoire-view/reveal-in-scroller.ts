/**
 * Whether `node` scrolls its content up and down: it lets it (overflow-y
 * auto or scroll) and has more than it shows. A box that only clips
 * sideways computes overflow-y auto too, but has nothing to scroll.
 */
function scrolls(node: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(node);
  return (
    (overflowY === 'auto' || overflowY === 'scroll') &&
    node.scrollHeight > node.clientHeight
  );
}

/** The nearest ancestor of `element` that scrolls its content, never the page. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (
    let node = element.parentElement;
    node !== null && node !== document.body;
    node = node.parentElement
  ) {
    if (scrolls(node)) return node;
  }
  return null;
}

/**
 * Scrolls `element` into its own scroller's view, the least distance, and
 * never the page (finding 8): `scrollIntoView` scrolls every ancestor, the
 * page with them. On a desktop the scroller is the move list's box; on a
 * phone, where that box does not scroll, the panel.
 */
export function revealInScroller(element: HTMLElement): void {
  const scroller = scrollerOf(element);
  if (scroller === null) return;
  const box = scroller.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  if (at.top < box.top) scroller.scrollTop += at.top - box.top;
  else if (at.bottom > box.bottom) scroller.scrollTop += at.bottom - box.bottom;
}
