import type { JSX } from 'react';
import { CardSkeletons } from '../card-skeletons';
import { CONTENT } from '../surfaces';
import { FideHeader } from './fide-header';

/**
 * Opponents while it loads: its header, the ID field (its height, and its
 * width beside the Search button from sm), then the explanation card.
 */
export default function FideLoading(): JSX.Element {
  return (
    <main aria-busy="true" className={`${CONTENT} gap-6`}>
      <FideHeader />
      <CardSkeletons sizes={['h-11 w-full sm:max-w-sm', 'h-24']} />
    </main>
  );
}
