import { PGN_LIMITS, playerSide, type Side } from '@mychess/chess';
import {
  useEffect,
  useReducer,
  useRef,
  useTransition,
  type Dispatch,
  type RefObject,
} from 'react';
import type {
  ImportPreview,
  ImportRefusalKey,
  ImportRefused,
} from '../../../server/import-preview';
import { useSlow } from '../../use-slow';
import { confirmImportAction, previewImportAction } from './actions';

/** One of the account's repertoires the upload can be added to. */
export interface ImportOption {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

export type TargetChoice =
  { readonly kind: 'new' } | { readonly kind: 'existing'; readonly id: string };

/** The file or pasted text as read and previewed. */
interface Upload {
  readonly text: string;
  /** The file's name; null for pasted text. */
  readonly name: string | null;
  readonly side: Side;
}

/** A refusal to show: its catalogue key and the limit it names, if any. */
export interface FlowMessage {
  readonly key: string;
  readonly limit?: number;
}

/** What the flow is waiting for. */
type Busy = 'reading' | 'updating' | 'importing';

interface FlowState {
  readonly side: Side;
  /**
   * The side was chosen, by the player or by opening the flow from a
   * repertoire: a file's players no longer set it (#330 decision 8).
   */
  readonly sideChosen: boolean;
  /** The file chosen, or null; never set together with pasted text. */
  readonly file: File | null;
  /** The PGN pasted (R-209), or ''; never set together with a file. */
  readonly pasted: string;
  /** Set once the file is previewed: step 1 then collapses. */
  readonly upload: Upload | null;
  readonly preview: ImportPreview | null;
  readonly target: TargetChoice;
  readonly name: string;
  readonly message: FlowMessage | null;
  /** The repertoire changed since the preview: offer "Preview again". */
  readonly stale: boolean;
  readonly busy: Busy;
}

type Patch = Partial<Pick<FlowState, 'name' | 'target' | 'message'>>;

/** What step 1 sends: a file or pasted text, one of the two (decision 10). */
type Source = File | string;

type FlowEvent =
  | { readonly type: 'set'; readonly patch: Patch }
  /** The player chose a side. */
  | { readonly type: 'side'; readonly side: Side }
  /** A file chosen (pasted text cleared) or text pasted (file cleared). */
  | { readonly type: 'source'; readonly source: Source | null }
  /** The side `source`'s players name the account on, once read. */
  | {
      readonly type: 'sideFound';
      readonly source: Source;
      readonly side: Side | null;
    }
  | { readonly type: 'start'; readonly busy: Busy }
  | {
      readonly type: 'previewed';
      readonly upload: Upload;
      readonly preview: ImportPreview;
    }
  | { readonly type: 'refused'; readonly refused: ImportRefused }
  | { readonly type: 'change' };

const NEW: TargetChoice = { kind: 'new' };

/** Refusals after which the chosen repertoire cannot be the target. */
const TARGET_GONE: ReadonlySet<ImportRefusalKey> = new Set([
  'repertoire.notFound',
  'repertoire.sideMismatch',
]);

const messageOf = ({ refusal }: ImportRefused): FlowMessage =>
  'limit' in refusal
    ? { key: refusal.reason, limit: refusal.limit }
    : { key: refusal.reason };

/** The flow's start: opened from a repertoire, its side and it as the target. */
function initialFlow(fixed: ImportOption | null): FlowState {
  return {
    side: fixed?.side ?? 'white',
    sideChosen: fixed !== null,
    file: null,
    pasted: '',
    upload: null,
    preview: null,
    target: fixed === null ? NEW : { kind: 'existing', id: fixed.id },
    name: '',
    message: null,
    stale: false,
    busy: 'reading',
  };
}

const CLEARED = { message: null, stale: false } as const;

/** Applies `patch`; another side drops the chosen repertoire, which is of the old one. */
function patched(state: FlowState, patch: Partial<FlowState>): FlowState {
  const next = { ...state, ...patch };
  return next.side === state.side ? next : { ...next, target: NEW };
}

/**
 * The source step 1 holds, and sends: the pasted text unless it is blank,
 * else the file; null when there is neither.
 */
function heldSource({ file, pasted }: FlowState): Source | null {
  return pasted.trim() === '' ? file : pasted;
}

/**
 * The side's default from `source`'s players (decision 8): the side they
 * name the account on, otherwise White. Only while the side is not chosen
 * (by the player, or by opening the flow from a repertoire) and `source` is
 * still the one step 1 holds, so a slow read never overrides a newer choice.
 */
function sideFound(
  state: FlowState,
  source: Source,
  side: Side | null,
): FlowState {
  if (state.sideChosen || heldSource(state) !== source) return state;
  return patched(state, { side: side ?? 'white' });
}

/** Step 1 holding `source` alone: a file clears the paste, a paste the file. */
const withSource = (state: FlowState, source: Source | null): FlowState =>
  typeof source === 'string'
    ? { ...state, file: null, pasted: source }
    : { ...state, file: source, pasted: '' };

/**
 * The flow once `upload` is previewed. A preview as the other side
 * (switchSide) takes that side only now, so a refused one leaves the side
 * and the target as they were; once taken, the side counts as chosen.
 */
function previewed(
  state: FlowState,
  upload: Upload,
  preview: ImportPreview,
): FlowState {
  return patched(state, {
    upload,
    preview,
    side: upload.side,
    sideChosen: state.sideChosen || upload.side !== state.side,
  });
}

function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'set':
      return patched(state, event.patch);
    case 'side':
      return patched(state, { side: event.side, sideChosen: true });
    case 'source':
      return withSource(state, event.source);
    case 'sideFound':
      return sideFound(state, event.source, event.side);
    case 'start':
      return { ...state, ...CLEARED, busy: event.busy };
    case 'previewed':
      return previewed(state, event.upload, event.preview);
    case 'refused':
      return {
        ...state,
        message: messageOf(event.refused),
        stale: event.refused.refusal.reason === 'repertoire.stale',
        target: TARGET_GONE.has(event.refused.refusal.reason)
          ? NEW
          : state.target,
      };
    case 'change':
      return { ...state, ...CLEARED, upload: null, preview: null };
  }
}

/** The bytes `text` takes as UTF-8, as the server counts them (R-66). */
const byteLength = (text: string): number =>
  new TextEncoder().encode(text).length;

const TOO_LARGE: FlowMessage = { key: 'pgn.tooLarge', limit: PGN_LIMITS.bytes };

/** The source the browser refuses before uploading it, or null. */
function sourceRefusal(source: Source | null): FlowMessage | null {
  if (source === null) return { key: 'repertoires.import.noFile' };
  const bytes = typeof source === 'string' ? byteLength(source) : source.size;
  return bytes > PGN_LIMITS.bytes ? TOO_LARGE : null;
}

/** `source` read as an upload for `side`. */
const readSource = async (source: Source, side: Side): Promise<Upload> =>
  typeof source === 'string'
    ? { text: source, name: null, side }
    : { text: await source.text(), name: source.name, side };

interface StepFocus {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fileRef: RefObject<HTMLInputElement | null>;
}

/**
 * Focus after a step changes: the summary heading once a file is previewed,
 * the file input after "Change" (docs/design/repertoire-screen.md).
 */
function useStepFocus(upload: Upload | null): StepFocus {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wasPreviewed = useRef(false);
  useEffect(() => {
    if (upload !== null) headingRef.current?.focus();
    else if (wasPreviewed.current) fileRef.current?.focus();
    wasPreviewed.current = upload !== null;
  }, [upload]);
  return { headingRef, fileRef };
}

type Start = (work: () => Promise<void>) => void;

interface FlowActions {
  readonly submitFile: () => void;
  readonly chooseTarget: (choice: TargetChoice) => void;
  readonly previewAgain: () => void;
  /**
   * Previews the file again as `side`, into a new repertoire: the side the
   * preview suggests (#364, R-214).
   */
  readonly switchSide: (side: Side) => void;
  readonly confirm: () => void;
  /** Back to step 1 ("Change"). */
  readonly change: () => void;
}

/** Runs a preview of what `read` gives against `choice`. */
const previewer =
  (dispatch: Dispatch<FlowEvent>, start: Start) =>
  (busy: Busy, read: () => Promise<Upload>, choice: TargetChoice): void => {
    dispatch({ type: 'start', busy });
    start(async () => {
      const upload = await read();
      const outcome = await previewImportAction({
        text: upload.text,
        side: upload.side,
        into: choice.kind === 'existing' ? choice.id : undefined,
      });
      dispatch(
        outcome.ok
          ? { type: 'previewed', upload, preview: outcome.preview }
          : { type: 'refused', refused: outcome },
      );
    });
  };

/** The confirm request's target: a name, or the repertoire at its previewed version. */
const confirmedTarget = (state: FlowState): object =>
  state.target.kind === 'new'
    ? { kind: 'new', name: state.name }
    : {
        kind: 'existing',
        id: state.target.id,
        version: state.preview?.target?.version ?? 0,
      };

function flowActions(
  state: FlowState,
  dispatch: Dispatch<FlowEvent>,
  start: Start,
): FlowActions {
  const preview = previewer(dispatch, start);
  const { upload, side, target } = state;
  const again = (choice: TargetChoice): void => {
    if (upload !== null)
      preview('updating', () => Promise.resolve(upload), choice);
  };
  return {
    submitFile: () => {
      const source = heldSource(state);
      const refused = sourceRefusal(source);
      if (refused !== null || source === null) {
        dispatch({ type: 'set', patch: { message: refused } });
        return;
      }
      preview('reading', () => readSource(source, side), target);
    },
    chooseTarget: (choice) => {
      dispatch({ type: 'set', patch: { target: choice } });
      again(choice);
    },
    previewAgain: () => {
      again(target);
    },
    switchSide: (to) => {
      if (upload === null) return;
      preview('updating', () => Promise.resolve({ ...upload, side: to }), NEW);
    },
    change: () => {
      dispatch({ type: 'change' });
    },
    confirm: () => {
      if (upload === null) return;
      dispatch({ type: 'start', busy: 'importing' });
      start(async () => {
        // A successful import redirects to the repertoire; only refusals return.
        const refused = await confirmImportAction({
          text: upload.text,
          side: upload.side,
          target: confirmedTarget(state),
        });
        dispatch({ type: 'refused', refused });
      });
    },
  };
}

interface SourceActions {
  /** A file chosen (or none): it replaces any pasted text. */
  readonly chooseFile: (file: File | null) => void;
  /** Text typed or pasted (R-209): it replaces any chosen file. */
  readonly paste: (text: string) => void;
  readonly chooseSide: (side: Side) => void;
}

/**
 * The side `text`'s players name one of `names` on (#330 decision 8); none
 * for text over the byte limit, which the preview refuses anyway.
 */
const namedSide = (text: string, names: readonly string[]): Side | null =>
  byteLength(text) > PGN_LIMITS.bytes ? null : playerSide(text, names);

/** How long typing pauses before the pasted players are read. */
const PASTE_SETTLE_MS = 300;

/** Runs one piece of work later; a newer one, or `cancel`, drops it. */
interface Later {
  readonly run: (work: () => void) => void;
  readonly cancel: () => void;
}

/** `Later` after PASTE_SETTLE_MS, dropped when the flow unmounts. */
function useLater(): Later {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    run: (work) => {
      cancel();
      timer.current = setTimeout(work, PASTE_SETTLE_MS);
    },
    cancel,
  };
}

/**
 * Step 1's inputs. A file or a paste each replaces the other, so exactly one
 * is sent (decision 10); each reports the side its players name the account
 * on, which the reducer takes as the default (decision 8). Pasted text is
 * read once typing pauses, not on each keystroke over up to 2 MB.
 */
function sourceActions(
  dispatch: Dispatch<FlowEvent>,
  names: readonly string[],
  {
    fileRef,
    later,
  }: {
    readonly fileRef: RefObject<HTMLInputElement | null>;
    readonly later: Later;
  },
): SourceActions {
  const found = (source: Source, side: Side | null): void => {
    dispatch({ type: 'sideFound', source, side });
  };
  return {
    chooseFile: (file) => {
      later.cancel();
      dispatch({ type: 'source', source: file });
      if (file === null) return;
      // A file too large or unreadable names no one; the preview says why
      // it is refused.
      if (file.size > PGN_LIMITS.bytes) {
        found(file, null);
        return;
      }
      void file.text().then(
        (text) => {
          found(file, playerSide(text, names));
        },
        () => {
          found(file, null);
        },
      );
    },
    paste: (text) => {
      // The file input forgets its file too, so choosing it again counts.
      if (fileRef.current !== null) fileRef.current.value = '';
      dispatch({ type: 'source', source: text });
      later.run(() => {
        found(text, namedSide(text, names));
      });
    },
    chooseSide: (side) => {
      later.cancel();
      dispatch({ type: 'side', side });
    },
  };
}

export interface ImportFlow
  extends FlowState, FlowActions, SourceActions, StepFocus {
  readonly sideFixed: boolean;
  /** A preview or the import is running. */
  readonly pending: boolean;
  /** What a wait of over a second is for, to say in the status line. */
  readonly slow: Busy | null;
  readonly dispatch: Dispatch<FlowEvent>;
}

/**
 * The import flow's state and what the steps do with it; `names` are the
 * account's, which a file's players may give it by (decision 8).
 */
export function useImportFlow(
  options: readonly ImportOption[],
  preselected: string | null,
  names: readonly string[],
): ImportFlow {
  const fixed = options.find((option) => option.id === preselected) ?? null;
  const [state, dispatch] = useReducer(reduceFlow, fixed, initialFlow);
  const [pending, startTransition] = useTransition();
  const slow = useSlow(pending);
  const focus = useStepFocus(state.upload);
  const later = useLater();
  return {
    ...state,
    ...focus,
    ...flowActions(state, dispatch, startTransition),
    ...sourceActions(dispatch, names, {
      fileRef: focus.fileRef,
      later,
    }),
    sideFixed: fixed !== null,
    pending,
    slow: slow ? state.busy : null,
    dispatch,
  };
}
