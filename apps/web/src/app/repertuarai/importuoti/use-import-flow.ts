import { PGN_LIMITS, type Side } from '@mychess/chess';
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

/** The file as read and previewed. */
interface Upload {
  readonly text: string;
  readonly name: string;
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
  readonly file: File | null;
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

type Patch = Partial<
  Pick<FlowState, 'side' | 'file' | 'name' | 'target' | 'message'>
>;

type FlowEvent =
  | { readonly type: 'set'; readonly patch: Patch }
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

const messageOf = (refused: ImportRefused): FlowMessage =>
  refused.limit === undefined
    ? { key: refused.refusal }
    : { key: refused.refusal, limit: refused.limit };

/** The flow's start: opened from a repertoire, its side and it as the target. */
function initialFlow(fixed: ImportOption | null): FlowState {
  return {
    side: fixed?.side ?? 'white',
    file: null,
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
function patched(state: FlowState, patch: Patch): FlowState {
  const next = { ...state, ...patch };
  return next.side === state.side ? next : { ...next, target: NEW };
}

function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'set':
      return patched(state, event.patch);
    case 'start':
      return { ...state, ...CLEARED, busy: event.busy };
    case 'previewed':
      return { ...state, upload: event.upload, preview: event.preview };
    case 'refused':
      return {
        ...state,
        message: messageOf(event.refused),
        stale: event.refused.refusal === 'repertoire.stale',
        target: TARGET_GONE.has(event.refused.refusal) ? NEW : state.target,
      };
    case 'change':
      return { ...state, ...CLEARED, upload: null, preview: null };
  }
}

/** The file the browser refuses before uploading it, or null. */
function fileRefusal(file: File | null): FlowMessage | null {
  if (file === null) return { key: 'repertoires.import.noFile' };
  return file.size > PGN_LIMITS.bytes
    ? { key: 'pgn.tooLarge', limit: PGN_LIMITS.bytes }
    : null;
}

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
  const { file, upload, side, target } = state;
  const again = (choice: TargetChoice): void => {
    if (upload !== null)
      preview('updating', () => Promise.resolve(upload), choice);
  };
  return {
    submitFile: () => {
      const refused = fileRefusal(file);
      if (refused !== null || file === null) {
        dispatch({ type: 'set', patch: { message: refused } });
        return;
      }
      const read = async (): Promise<Upload> => ({
        text: await file.text(),
        name: file.name,
        side,
      });
      preview('reading', read, target);
    },
    chooseTarget: (choice) => {
      dispatch({ type: 'set', patch: { target: choice } });
      again(choice);
    },
    previewAgain: () => {
      again(target);
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

export interface ImportFlow extends FlowState, FlowActions, StepFocus {
  readonly sideFixed: boolean;
  /** A preview or the import is running. */
  readonly pending: boolean;
  /** What a wait of over a second is for, to say in the status line. */
  readonly slow: Busy | null;
  readonly dispatch: Dispatch<FlowEvent>;
}

/** The import flow's state and what the steps do with it. */
export function useImportFlow(
  options: readonly ImportOption[],
  preselected: string | null,
): ImportFlow {
  const fixed = options.find((option) => option.id === preselected) ?? null;
  const [state, dispatch] = useReducer(reduceFlow, fixed, initialFlow);
  const [pending, startTransition] = useTransition();
  const slow = useSlow(pending);
  const focus = useStepFocus(state.upload);
  return {
    ...state,
    ...focus,
    ...flowActions(state, dispatch, startTransition),
    sideFixed: fixed !== null,
    pending,
    slow: slow ? state.busy : null,
    dispatch,
  };
}
