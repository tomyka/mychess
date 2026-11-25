'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';
import { PRIMARY_BUTTON } from '../buttons';

/**
 * "Next" while a coach note holds the drill (R-174), in review and in a
 * learn pass with arrows off: in the bottom bar, the thumb zone, before End
 * session, so on a phone it is not under the fold below the note; it takes
 * the focus from the move field, now hidden.
 */
export function NextButton({
  onNext,
}: {
  readonly onNext: () => void;
}): JSX.Element {
  const t = useTranslations('training.drill');
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button ref={ref} type="button" onClick={onNext} className={PRIMARY_BUTTON}>
      {t('next')}
    </button>
  );
}
