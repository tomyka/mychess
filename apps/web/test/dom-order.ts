/**
 * The positions in `nodes` whose node does not come after the one before
 * it in the document; none when they are in order. The DOM order is the
 * visual and the Tab order (WCAG 2.4.3). Asserted as
 * `expect(outOfOrder(nodes)).toEqual([])`, so the lint rule that every
 * test asserts sees the `expect` (an `expectInOrder` helper would not
 * count, and its configuration is gate configuration).
 */
export function outOfOrder(nodes: readonly Element[]): number[] {
  return nodes.flatMap((node, i) => {
    const before = i === 0 ? undefined : nodes[i - 1];
    if (before === undefined) return [];
    const follows =
      before.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    return follows === 0 ? [i] : [];
  });
}
