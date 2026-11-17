// Pieces for React's useSyncExternalStore that the browser-only stores
// share: the server, and the browser while it hydrates, read nothing, so
// the first render matches the server's.

/** The snapshot on the server and while hydrating: nothing yet. */
export const noSnapshot = (): null => null;

/** The subscription of a store read once: it never changes. */
export const neverChanges = (): (() => void) => () => undefined;
