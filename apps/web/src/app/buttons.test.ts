import { describe, expect, it } from 'vitest';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';

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
});
