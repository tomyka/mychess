import type { JSX } from 'react';
import { CardSkeletons } from '../card-skeletons';
import { CONTENT } from '../surfaces';
import { FideHeader } from './fide-header';

/** Opponents while it loads: its header, then the search card. */
export default function FideLoading(): JSX.Element {
  return (
    <main aria-busy="true" className={`${CONTENT} gap-6`}>
      <FideHeader />
      <CardSkeletons sizes={['h-36']} />
    </main>
  );
}
