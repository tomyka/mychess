import { PGN_LIMITS, type Side } from '@mychess/chess';
import { isRepertoireNameRefusal } from '@mychess/domain';
import type {
  ConfirmRequestInput,
  ImportPreview,
  ImportRefusalKey,
  ImportRefused,
  ImportTarget,
} from '../../../server/import-preview';

// The import flow's state and the rules it decides: what each event does,
// whether Import may be pressed and what it sends, which refusal marks the
// name, which repertoires may take the upload. The hook (use-import-flow)
// runs it; the steps only show what it decided.

/** One of the account's repertoires the upload can be added to. */
export interface ImportOption {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

export type TargetChoice =
  { readonly kind: 'new' } | { readonly kind: 'existing'; readonly id: string };

/** The file or pasted text as read and previewed. */
export interface Upload {
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
export type Busy = 'reading' | 'updating' | 'importing';

export interface FlowState {
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
  /**
   * The name last suggested from a file: while `name` is still it, the
   * player has not changed it and the next file's suggestion replaces it.
   */
  readonly suggested: string;
  readonly message: FlowMessage | null;
  /** The repertoire changed since the preview: offer "Preview again". */
  readonly stale: boolean;
  readonly busy: Busy;
}

/** What step 1 sends: a file or pasted text, one of the two (decision 10). */
export type Source = File | string;

export type FlowEvent =
  /** The player typed the new repertoire's name. */
  | { readonly type: 'name'; readonly name: string }
  /** The player chose where the upload goes. */
  | { readonly type: 'target'; readonly target: TargetChoice }
  /** The browser refused step 1 before sending it. */
  | { readonly type: 'notSent'; readonly message: FlowMessage }
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

export const NEW: TargetChoice = { kind: 'new' };

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
export function initialFlow(fixed: ImportOption | null): FlowState {
  return {
    side: fixed?.side ?? 'white',
    sideChosen: fixed !== null,
    file: null,
    pasted: '',
    upload: null,
    preview: null,
    target: fixed === null ? NEW : { kind: 'existing', id: fixed.id },
    name: '',
    suggested: '',
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
export function heldSource({ file, pasted }: FlowState): Source | null {
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
 * The name once a preview arrives: the one it suggests, unless the player
 * changed the last suggestion.
 */
function named(state: FlowState, preview: ImportPreview): Partial<FlowState> {
  if (state.name !== state.suggested) return {};
  const name = preview.suggestedName;
  return { name, suggested: name };
}

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
    ...named(state, preview),
    upload,
    preview,
    side: upload.side,
    sideChosen: state.sideChosen || upload.side !== state.side,
  });
}

/** The flow after a request was refused. */
const refusedBy = (state: FlowState, refused: ImportRefused): FlowState => ({
  ...state,
  message: messageOf(refused),
  stale: refused.refusal.reason === 'repertoire.stale',
  target: TARGET_GONE.has(refused.refusal.reason) ? NEW : state.target,
});

/** The player's choices in the steps. */
type InputEvent = Extract<
  FlowEvent,
  { readonly type: 'name' | 'target' | 'side' | 'source' | 'sideFound' }
>;

/** The requests' progress and outcomes. */
type RequestEvent = Exclude<FlowEvent, InputEvent>;

const INPUT_TYPES: ReadonlySet<FlowEvent['type']> = new Set([
  'name',
  'target',
  'side',
  'source',
  'sideFound',
]);

const isInput = (event: FlowEvent): event is InputEvent =>
  INPUT_TYPES.has(event.type);

function reduceInput(state: FlowState, event: InputEvent): FlowState {
  switch (event.type) {
    case 'name':
      return { ...state, name: event.name };
    case 'target':
      return { ...state, target: event.target };
    case 'side':
      return patched(state, { side: event.side, sideChosen: true });
    case 'source':
      return withSource(state, event.source);
    case 'sideFound':
      return sideFound(state, event.source, event.side);
  }
}

function reduceRequest(state: FlowState, event: RequestEvent): FlowState {
  switch (event.type) {
    case 'notSent':
      return { ...state, message: event.message };
    case 'start':
      return { ...state, ...CLEARED, busy: event.busy };
    case 'previewed':
      return previewed(state, event.upload, event.preview);
    case 'refused':
      return refusedBy(state, event.refused);
    case 'change':
      return { ...state, ...CLEARED, upload: null, preview: null };
  }
}

export const reduceFlow = (state: FlowState, event: FlowEvent): FlowState =>
  isInput(event) ? reduceInput(state, event) : reduceRequest(state, event);

/** The bytes `text` takes as UTF-8, as the server counts them (R-66). */
export const byteLength = (text: string): number =>
  new TextEncoder().encode(text).length;

const TOO_LARGE: FlowMessage = { key: 'pgn.tooLarge', limit: PGN_LIMITS.bytes };

/** The source the browser refuses before uploading it, or null. */
export function sourceRefusal(source: Source | null): FlowMessage | null {
  if (source === null) return { key: 'repertoires.import.noFile' };
  const bytes = typeof source === 'string' ? byteLength(source) : source.size;
  return bytes > PGN_LIMITS.bytes ? TOO_LARGE : null;
}

/** What Import sends: the previewed upload and where it goes. */
type ConfirmRequest = ConfirmRequestInput;

/** The confirm request's target, as the server parses it. */
type ConfirmTarget = ConfirmRequest['target'];

/**
 * Where Import sends the upload: a new repertoire by its name, or the chosen
 * repertoire at the version its preview was merged from (decision 6). Only
 * the target the shown preview is of: while another's preview runs, or
 * after it was refused, there is nothing to send (null). A repertoire's
 * version is known only from its own preview.
 */
function confirmedTarget(
  choice: TargetChoice,
  name: string,
  preview: ImportPreview,
): ConfirmTarget | null {
  const merged = preview.target;
  if (choice.kind === 'new') {
    return merged === null ? { kind: 'new', name } : null;
  }
  return merged?.id === choice.id
    ? { kind: 'existing', id: choice.id, version: merged.version }
    : null;
}

/**
 * The request Import sends, or null when it is refused: nothing previewed,
 * the preview refuses this target (R-115), or the shown preview is not of
 * the chosen target.
 */
export function confirmRequest(state: FlowState): ConfirmRequest | null {
  const { upload, preview } = state;
  if (upload === null || preview === null) return null;
  if (preview.refusal !== null) return null;
  const target = confirmedTarget(state.target, state.name, preview);
  return target === null
    ? null
    : { text: upload.text, side: upload.side, target };
}

/** The repertoires of `side`: the only ones an upload of it can join (R-101). */
export const targetsOf = (
  options: readonly ImportOption[],
  side: Side,
): readonly ImportOption[] => options.filter((option) => option.side === side);

/**
 * What the merge into the chosen repertoire adds, to show under it: none
 * when the preview is not of that repertoire or refuses it (R-115).
 */
export function addedTo(
  choice: TargetChoice,
  preview: ImportPreview,
): ImportTarget | null {
  if (choice.kind === 'new' || preview.refusal !== null) return null;
  return preview.target?.id === choice.id ? preview.target : null;
}

/** The last request's refusal marks the name field (a name refusal). */
export function nameRefused({ message }: FlowState): boolean {
  const key = message?.key;
  return key !== undefined && isRepertoireNameRefusal({ reason: key });
}

const BYTES_PER_MB = 1024 * 1024;

/** `message` with its limit as the text names it: the byte limit in MB. */
const shown = ({ key, limit }: FlowMessage): FlowMessage =>
  key === 'pgn.tooLarge' && limit !== undefined
    ? { key, limit: limit / BYTES_PER_MB }
    : { key, ...(limit === undefined ? {} : { limit }) };

/**
 * The flow's one refusal to show: the last request's, else why the preview
 * refuses Import (R-115); null for none.
 */
export function shownRefusal(state: FlowState): FlowMessage | null {
  const refusal = state.preview?.refusal ?? null;
  const message = state.message ?? (refusal === null ? null : { key: refusal });
  return message === null ? null : shown(message);
}
