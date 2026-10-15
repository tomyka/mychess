import { describe, expect, it } from 'vitest';
import {
  DISPLAY_NAME_ISSUES,
  DISPLAY_NAME_MAX,
  displayNameSchema,
} from './display-name';

describe('displayNameSchema', () => {
  it('trims the name', () => {
    expect(displayNameSchema.parse('  Rūta  ')).toBe('Rūta');
  });

  it('refuses a blank name', () => {
    const result = displayNameSchema.safeParse('   ');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DISPLAY_NAME_ISSUES.blank);
  });

  it('takes a name of exactly the maximum length', () => {
    const name = 'a'.repeat(DISPLAY_NAME_MAX);
    expect(displayNameSchema.parse(name)).toBe(name);
  });

  it('refuses a name one character too long', () => {
    const result = displayNameSchema.safeParse(
      'a'.repeat(DISPLAY_NAME_MAX + 1),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DISPLAY_NAME_ISSUES.tooLong);
  });
});
