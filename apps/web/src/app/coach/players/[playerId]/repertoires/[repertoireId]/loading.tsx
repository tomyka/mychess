import type { JSX } from 'react';
import {
  HeaderFrame,
  RepertoireLoadingShell,
  SKELETON_LINE,
} from '../../../../../repertoire-view';

// The coach's read-only view of a shared repertoire while it loads
// (docs/design/coach-shared-repertoire.md, States): its header's skeleton
// (the way back, the name and, on a phone, the player's name) over the
// repertoire page's loading shell, so the board does not jump when the page
// arrives.
export default function SharedRepertoireLoading(): JSX.Element {
  return (
    <RepertoireLoadingShell
      header={
        <HeaderFrame element="div">
          <div className="flex min-h-touch min-w-touch items-center">
            <div className={`${SKELETON_LINE} w-5 lg:w-48`} />
          </div>
          <div className="flex flex-1 flex-col gap-1 lg:flex-none">
            <div className="h-6 w-56 rounded-control bg-sunken lg:h-9" />
            <div className={`${SKELETON_LINE} w-32 lg:hidden`} />
          </div>
        </HeaderFrame>
      }
    />
  );
}
