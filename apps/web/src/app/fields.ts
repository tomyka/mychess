// The form-field class name every page shares: a 44px touch target for a
// text input, a date input or a select, edged in the error colour while
// aria-invalid. The buttons are in ./buttons.ts.

export const FIELD =
  'min-h-touch rounded-control border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error';

// A radio card: a label (or a box holding one) edged like a field. Its
// chosen state is the accent-subtle tint with an accent ring in both themes
// (#381 dark finding 15: sunken read as a hole in dark).
export const RADIO_CARD =
  'rounded-control border border-border-strong bg-surface has-checked:border-accent has-checked:bg-accent-subtle has-checked:ring-1 has-checked:ring-accent';
