import { useEffect, useRef, type RefObject } from 'react';

/** Where the Repertoire screen's rename and delete are. */
export type Step = 'idle' | 'renaming' | 'renamed' | 'deleting';

/** Puts focus back on the button that opened a closed step. */
export function useReturnFocus(step: Step): {
  rename: RefObject<HTMLButtonElement | null>;
  remove: RefObject<HTMLButtonElement | null>;
} {
  const rename = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const from = useRef<Step>(step);
  useEffect(() => {
    if (step !== 'renaming' && from.current === 'renaming')
      rename.current?.focus();
    if (step === 'idle' && from.current === 'deleting') remove.current?.focus();
    from.current = step;
  }, [step]);
  return { rename, remove };
}
