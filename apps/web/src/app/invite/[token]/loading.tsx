import type { JSX } from 'react';
import { CardSkeletons } from '../../card-skeletons';
import { EntryFrame } from '../../entry-frame';

/**
 * The invite page while it loads: its lines in the entry frame's card, the
 * frame's main landmark marked busy.
 */
export default function InviteLoading(): JSX.Element {
  return (
    <EntryFrame busy>
      <CardSkeletons sizes={['h-9 w-3/4', 'h-16', 'h-11 w-40']} />
    </EntryFrame>
  );
}
