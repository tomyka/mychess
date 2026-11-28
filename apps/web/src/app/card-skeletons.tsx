import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SlowStatus } from './slow-status';

/**
 * A page's cards while it loads (#381 part 6), as the other loading pages
 * draw them: the late "Loading" line, then one still `bg-sunken` block per
 * size, hidden from a screen reader. The sizes are Tailwind classes written
 * out in the caller, so the build sees them. The caller marks its main
 * landmark busy.
 */
export function CardSkeletons({
  sizes,
}: {
  readonly sizes: readonly string[];
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <>
      <SlowStatus text={t('loading')} />
      {sizes.map((size, index) => (
        <div
          // The placeholders never reorder.
          key={index}
          aria-hidden="true"
          className={`${size} rounded-card bg-sunken`}
        />
      ))}
    </>
  );
}
