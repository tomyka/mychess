import { describe, expect, it } from 'vitest';
import {
  COMPACT_TONAL,
  DANGER_OUTLINE_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TONAL_BUTTON,
} from './buttons';

const classes = (button: string): readonly string[] => button.split(' ');

describe('button classes', () => {
  it('mutes a disabled primary button: sunken, muted text, not faded', () => {
    expect(classes(PRIMARY_BUTTON)).toEqual(
      expect.arrayContaining([
        'disabled:cursor-not-allowed',
        'disabled:bg-sunken',
        'disabled:text-fg-muted',
      ]),
    );
    expect(PRIMARY_BUTTON).not.toMatch(/disabled:opacity/);
  });

  it('fades any other disabled button to 85%, keeping its colours', () => {
    expect(classes(SECONDARY_BUTTON)).toContain('disabled:opacity-85');
    expect(classes(SECONDARY_BUTTON)).not.toContain('disabled:bg-sunken');
  });

  it('draws the compact tonal button as the tonal one at px-3 and text-sm, still 44px high, with no overrides', () => {
    const compact = classes(COMPACT_TONAL);
    expect(compact).toEqual(
      expect.arrayContaining([
        'min-h-touch',
        'px-3',
        'text-sm',
        'bg-accent-subtle',
        'text-accent',
        'disabled:opacity-85',
      ]),
    );
    // One padding and one size: nothing for the cascade to decide.
    expect(compact).not.toContain('px-4');
    expect(compact).not.toContain('text-base');
    expect(COMPACT_TONAL).not.toContain('!');
  });

  it('outlines a button that takes away in the error tone, with no overrides', () => {
    const danger = classes(DANGER_OUTLINE_BUTTON);
    expect(danger).toEqual(
      expect.arrayContaining([
        'min-h-touch',
        'border',
        'border-error',
        'bg-surface',
        'text-error',
        'disabled:opacity-85',
      ]),
    );
    // One border colour and one text colour: nothing for the cascade.
    expect(danger).not.toContain('border-border-strong');
    expect(danger).not.toContain('text-fg');
  });

  it('fades an unavailable (aria-disabled) secondary or tonal button to half', () => {
    for (const button of [SECONDARY_BUTTON, TONAL_BUTTON, COMPACT_TONAL])
      expect(classes(button)).toEqual(
        expect.arrayContaining([
          'aria-disabled:cursor-not-allowed',
          'aria-disabled:opacity-50',
        ]),
      );
  });
});
