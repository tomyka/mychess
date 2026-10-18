// The repertoire page's client state as one pure reducer: where the board
// is (chapter and path), the mode, and the outcome of the last save.
import {
  chapterChildren,
  chapterOf,
  moveKey,
  type MarkColor,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';

export interface ScreenMessage {
  /** A catalogue key. */
  readonly key: string;
  readonly tone: 'success' | 'error' | 'info';
  readonly values?: Readonly<Record<string, string | number>>;
}

export interface ScreenState {
  readonly graph: RepertoireGraph;
  readonly version: number;
  readonly chapterId: string | null;
  /** The moves from the chapter's root to the shown position. */
  readonly path: readonly RepertoireMove[];
  readonly mode: 'browse' | 'build';
  readonly drawMode: boolean;
  readonly drawColor: MarkColor;
  /** Draw mode's first tapped square, waiting for the second. */
  readonly drawFrom: string | null;
  readonly saving: boolean;
  /** The repertoire changed elsewhere; edits wait for a reload. */
  readonly stale: boolean;
  readonly message: ScreenMessage | null;
  /** Bumped to put the board's pieces back. */
  readonly revision: number;
}

type NavigationAction =
  | { readonly type: 'chapter'; readonly chapterId: string }
  | { readonly type: 'goto'; readonly path: readonly RepertoireMove[] }
  | { readonly type: 'back' }
  | { readonly type: 'forward' };

type BuilderAction =
  | { readonly type: 'mode'; readonly mode: 'browse' | 'build' }
  | { readonly type: 'draw'; readonly on: boolean }
  | { readonly type: 'drawColor'; readonly color: MarkColor }
  | { readonly type: 'drawFrom'; readonly square: string | null };

type SaveAction =
  | { readonly type: 'saving' }
  | {
      readonly type: 'saved';
      readonly graph: RepertoireGraph;
      readonly version: number;
      readonly path?: readonly RepertoireMove[];
      readonly chapterId?: string;
    }
  | {
      readonly type: 'refused';
      readonly reason: string;
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | { readonly type: 'say'; readonly message: ScreenMessage | null }
  | { readonly type: 'reset' };

export type ScreenAction = NavigationAction | BuilderAction | SaveAction;

/** The longest start of `path` still in the chapter, with today's move objects. */
export function keepPath(
  graph: RepertoireGraph,
  chapterId: string | null,
  path: readonly RepertoireMove[],
): RepertoireMove[] {
  if (chapterId === null) return [];
  const held = new Map(
    graph.moves
      .filter((m) => m.chapters.includes(chapterId))
      .map((m) => [moveKey(m.from, m.san), m]),
  );
  const kept: RepertoireMove[] = [];
  for (const move of path) {
    const now = held.get(moveKey(move.from, move.san));
    if (now === undefined) break;
    kept.push(now);
  }
  return kept;
}

/** The position the screen shows: after the path, or the chapter's root. */
export function currentKey(
  state: Pick<ScreenState, 'graph' | 'chapterId' | 'path'>,
): string | null {
  const last = state.path.at(-1);
  if (last !== undefined) return last.to;
  if (state.chapterId === null) return null;
  return chapterOf(state.graph, state.chapterId)?.rootKey ?? null;
}

/** The page as it opens: the first chapter at its root (builder mode without one). */
export function initialState(
  graph: RepertoireGraph,
  version: number,
): ScreenState {
  const first = graph.chapters[0];
  return {
    graph,
    version,
    chapterId: first?.id ?? null,
    path: [],
    mode: first === undefined ? 'build' : 'browse',
    drawMode: false,
    drawColor: 'G',
    drawFrom: null,
    saving: false,
    stale: false,
    message: null,
    revision: 0,
  };
}

/** One step along the main line (R-79: the first move added), if there is one. */
function forward(state: ScreenState): ScreenState {
  const key = currentKey(state);
  if (key === null || state.chapterId === null) return state;
  const [next] = chapterChildren(state.graph)(state.chapterId)(key);
  return next === undefined ? state : { ...state, path: [...state.path, next] };
}

function navigate(state: ScreenState, action: NavigationAction): ScreenState {
  switch (action.type) {
    case 'chapter':
      return { ...state, chapterId: action.chapterId, path: [] };
    case 'goto':
      return { ...state, path: action.path };
    case 'back':
      return state.path.length === 0
        ? state
        : { ...state, path: state.path.slice(0, -1) };
    case 'forward':
      return forward(state);
  }
}

function builder(state: ScreenState, action: BuilderAction): ScreenState {
  switch (action.type) {
    case 'mode':
      return { ...state, mode: action.mode };
    case 'draw':
      return { ...state, drawMode: action.on, drawFrom: null };
    case 'drawColor':
      return { ...state, drawColor: action.color };
    case 'drawFrom':
      return { ...state, drawFrom: action.square };
  }
}

function saved(
  state: ScreenState,
  action: Extract<SaveAction, { type: 'saved' }>,
): ScreenState {
  const chapterId = action.chapterId ?? state.chapterId;
  return {
    ...state,
    graph: action.graph,
    version: action.version,
    chapterId,
    path: keepPath(action.graph, chapterId, action.path ?? state.path),
    saving: false,
  };
}

function refused(
  state: ScreenState,
  { reason, values }: Extract<SaveAction, { type: 'refused' }>,
): ScreenState {
  const message: ScreenMessage =
    values === undefined
      ? { key: reason, tone: 'error' }
      : { key: reason, tone: 'error', values };
  return {
    ...state,
    saving: false,
    stale: state.stale || reason === 'repertoire.stale',
    message,
  };
}

function save(state: ScreenState, action: SaveAction): ScreenState {
  switch (action.type) {
    case 'saving':
      return { ...state, saving: true };
    case 'saved':
      return saved(state, action);
    case 'refused':
      return refused(state, action);
    case 'say':
      return { ...state, message: action.message };
    case 'reset':
      return { ...state, revision: state.revision + 1 };
  }
}

const NAVIGATION: ReadonlySet<string> = new Set([
  'chapter',
  'goto',
  'back',
  'forward',
]);
const BUILDER: ReadonlySet<string> = new Set([
  'mode',
  'draw',
  'drawColor',
  'drawFrom',
]);

const isNavigation = (action: ScreenAction): action is NavigationAction =>
  NAVIGATION.has(action.type);
const isBuilder = (action: ScreenAction): action is BuilderAction =>
  BUILDER.has(action.type);

export function screenReducer(
  state: ScreenState,
  action: ScreenAction,
): ScreenState {
  if (isNavigation(action)) return navigate(state, action);
  if (isBuilder(action)) return builder(state, action);
  return save(state, action);
}
