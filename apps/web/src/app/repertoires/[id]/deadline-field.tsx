'use client';

import { useId, useState, type JSX } from 'react';
import { MEDIUM_DATE } from '../../../lib/date-format';
import { FIELD } from '../../fields';
import { useDeadline } from '../../use-deadline';

/**
 * A deadline's date field (spec, Assignments on the Repertoire screen):
 * the native date input, which sends `YYYY-MM-DD` as `deadline`, with the
 * picked day written beside it as day, month and year ("Dec 20, 2026"),
 * since the native input writes it in the browser's own order. Today is
 * the earliest day as a hint only: the server refuses a past one (R-203).
 */
export function DeadlineField({
  label,
  defaultValue,
  today,
}: {
  readonly label: string;
  /** The current deadline, `YYYY-MM-DD`; empty for none. */
  readonly defaultValue: string;
  /** Today in Vilnius, from the loader. */
  readonly today: string;
}): JSX.Element {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const medium = useDeadline(() => MEDIUM_DATE);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          id={id}
          type="date"
          name="deadline"
          value={value}
          min={today}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className={FIELD}
        />
        {value === '' ? null : (
          <span className="text-sm text-fg-muted">{medium(value)}</span>
        )}
      </div>
    </div>
  );
}
