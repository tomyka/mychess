import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NameField, type NameFieldProps } from './profile-fields';

function renderField(props: Partial<NameFieldProps> = {}): HTMLFormElement {
  const { container } = render(
    <form>
      <NameField
        label="Display name"
        initial="Rūta"
        invalid={false}
        statusId="status"
        {...props}
      />
      <p id="status">Refused</p>
    </form>,
  );
  const form = container.querySelector('form');
  if (form === null) throw new Error('the field sits in a form');
  return form;
}

const field = () => screen.getByLabelText<HTMLInputElement>('Display name');

describe('NameField', () => {
  it('sends the prefilled name as displayName, unmarked and undescribed', () => {
    const form = renderField();
    expect(field().value).toBe('Rūta');
    expect(new FormData(form).get('displayName')).toBe('Rūta');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().getAttribute('aria-describedby')).toBeNull();
  });

  it('shows a hint under the field and is described by it', () => {
    renderField({ hint: 'Shown to your coach' });
    const hint = screen.getByText('Shown to your coach');
    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('when invalid is marked and described by the hint, then the status line', () => {
    renderField({ hint: 'Shown to your coach', invalid: true });
    const hint = screen.getByText('Shown to your coach');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(`${hint.id} status`);
  });
});
