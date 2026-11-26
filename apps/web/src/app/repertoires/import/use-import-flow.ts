import { PGN_LIMITS, playerSide, type Side } from '@mychess/chess';
import {
  useEffect,
  useReducer,
  useRef,
  useTransition,
  type Dispatch,
  type RefObject,
} from 'react';
import type { ImportTarget } from '../../../server/import-preview';
import { useSlow } from '../../use-slow';
import type { HeldSide } from '../side-field';
import { confirmImportAction, previewImportAction } from './actions';
import {
  addedTo,
  byteLength,
  confirmRequest,
  heldSource,
  initialFlow,
  nameRefused,
  NEW,
  reduceFlow,
  shownRefusal,
  sourceRefusal,
  targetsOf,
  type Busy,
  type FlowEvent,
  type FlowMessage,
  type FlowState,
  type ImportOption,
  type Source,
  type TargetChoice,
  type Upload,
} from './import-flow-state';
import type { ImportSummaryProps } from './import-summary';

/** Step 1: the file or pasted PGN and the side, with what each change does. */
export interface FileStepView {
  readonly file: File | null;
  readonly pasted: string;
  readonly side: HeldSide;
  /** A preview is running: the step waits. */
  readonly pending: boolean;
  readonly fileRef: RefObject<HTMLInputElement | null>;
  /** A file chosen (or none): it replaces any pasted text. */
  readonly onFile: (file: File | null) => void;
  /** Text typed or pasted (R-209): it replaces any chosen file. */
  readonly onPaste: (text: string) => void;
  readonly onSubmit: () => void;
}

/** Step 1 once previewed: what was read, and "Change". */
export interface ChosenView {
  /** The file's name; null for pasted text. */
  readonly name: string | null;
  readonly side: Side;
  readonly onChange: () => void;
}

/** Step 3: where the upload goes (R-101). */
export interface TargetView {
  /** The account's repertoires of the upload's side. */
  readonly options: readonly ImportOption[];
  readonly side: Side;
  readonly target: TargetChoice;
  readonly name: string;
  /** The last refusal was of the name. */
  readonly nameInvalid: boolean;
  /** What the merge adds to the chosen repertoire, to show under it; or null. */
  readonly added: ImportTarget | null;
  readonly onTarget: (target: TargetChoice) => void;
  readonly onName: (name: string) => void;
}

/** Steps 2 and 3, and Import, once the upload is previewed. */
export interface PreviewedView {
  readonly chosen: ChosenView;
  readonly summary: ImportSummaryProps;
  readonly target: TargetView;
  readonly confirm: {
    /** Import is refused, or a request is running. */
    readonly disabled: boolean;
    readonly onConfirm: () => void;
  };
}

/** The flow's one status line. */
export interface StatusView {
  /** The refusal to show, its limit as the text names it; or null. */
  readonly message: FlowMessage | null;
  /** What a wait of over a second is for, to say in the status line. */
  readonly slow: Busy | null;
  /** The repertoire changed since the preview: offer "Preview again". */
  readonly stale: boolean;
  readonly onPreviewAgain: () => void;
}

/**
 * The import flow as its steps show it: step 1 until the upload is
 * previewed, then steps 2 and 3; the status line throughout.
 */
export type ImportFlow = { readonly status: StatusView } & (
  | { readonly fileStep: FileStepView; readonly previewed: null }
  | { readonly fileStep: null; readonly previewed: PreviewedView }
);

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
        fileName: upload.name ?? undefined,
      });
      dispatch(
        outcome.ok
          ? { type: 'previewed', upload, preview: outcome.preview }
          : { type: 'refused', refused: outcome },
      );
    });
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
      if (refused !== null) dispatch({ type: 'notSent', message: refused });
      else if (source !== null)
        preview('reading', () => readSource(source, side), target);
    },
    chooseTarget: (choice) => {
      dispatch({ type: 'target', target: choice });
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
      const request = confirmRequest(state);
      if (request === null) return;
      dispatch({ type: 'start', busy: 'importing' });
      start(async () => {
        // A successful import redirects to the repertoire; only refusals return.
        const refused = await confirmImportAction(request);
        dispatch({ type: 'refused', refused });
      });
    },
  };
}

interface SourceActions {
  readonly chooseFile: (file: File | null) => void;
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

/** What the flow's state, actions and focus make of each step. */
interface Parts {
  readonly state: FlowState;
  readonly actions: FlowActions &
    SourceActions & { readonly name: (name: string) => void };
  readonly focus: StepFocus;
  readonly options: readonly ImportOption[];
  readonly sideFixed: boolean;
  readonly pending: boolean;
}

function fileStepOf({
  state,
  actions,
  focus,
  sideFixed,
  pending,
}: Parts): FileStepView {
  return {
    file: state.file,
    pasted: state.pasted,
    side: { side: state.side, fixed: sideFixed, onSide: actions.chooseSide },
    pending,
    fileRef: focus.fileRef,
    onFile: actions.chooseFile,
    onPaste: actions.paste,
    onSubmit: actions.submitFile,
  };
}

function previewedOf(parts: Parts): PreviewedView | null {
  const { state, actions, sideFixed, pending } = parts;
  const { upload, preview } = state;
  if (upload === null || preview === null) return null;
  return {
    chosen: { name: upload.name, side: upload.side, onChange: actions.change },
    summary: {
      preview,
      ...(sideFixed ? {} : { onSwitchSide: actions.switchSide }),
      busy: pending && state.busy === 'updating',
      headingRef: parts.focus.headingRef,
    },
    target: {
      options: targetsOf(parts.options, upload.side),
      side: upload.side,
      target: state.target,
      name: state.name,
      nameInvalid: nameRefused(state),
      added: addedTo(state.target, preview),
      onTarget: actions.chooseTarget,
      onName: actions.name,
    },
    confirm: {
      disabled: pending || confirmRequest(state) === null,
      onConfirm: actions.confirm,
    },
  };
}

/**
 * The import flow's state, decided into what each step shows. `opened` is
 * the account's repertoire the flow was opened from, if any: its side is
 * fixed and it is the target. `names` are the account's, which a file's
 * players may give it by (decision 8).
 */
export function useImportFlow(
  options: readonly ImportOption[],
  opened: ImportOption | null,
  names: readonly string[],
): ImportFlow {
  const [state, dispatch] = useReducer(reduceFlow, opened, initialFlow);
  const [pending, startTransition] = useTransition();
  const slow = useSlow(pending);
  const focus = useStepFocus(state.upload);
  const later = useLater();
  const actions = {
    ...flowActions(state, dispatch, startTransition),
    ...sourceActions(dispatch, names, { fileRef: focus.fileRef, later }),
    name: (name: string) => {
      dispatch({ type: 'name', name });
    },
  };
  const parts = {
    state,
    actions,
    focus,
    options,
    sideFixed: opened !== null,
    pending,
  };
  const status: StatusView = {
    message: shownRefusal(state),
    slow: slow ? state.busy : null,
    stale: state.stale,
    onPreviewAgain: actions.previewAgain,
  };
  const previewed = previewedOf(parts);
  return previewed === null
    ? { status, fileStep: fileStepOf(parts), previewed }
    : { status, fileStep: null, previewed };
}
