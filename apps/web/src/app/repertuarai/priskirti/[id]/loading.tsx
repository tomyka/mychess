import type { JSX } from 'react';
import {
  HeaderFrame,
  RepertoireLoadingShell,
  SKELETON_LINE,
} from '../../../repertoire-view';

// The assigned repertoire while it loads: its top bar's skeleton (the way
// home, the name, who assigned it) over the repertoire page's loading
// shell, so the board does not jump when the page arrives.
export default function AssignedRepertoireLoading(): JSX.Element {
  return (
    <RepertoireLoadingShell
      header={
        <HeaderFrame element="div">
          <div className="flex min-h-touch min-w-touch items-center">
            <div className={`${SKELETON_LINE} w-5 lg:w-40`} />
          </div>
          <div className="flex flex-1 flex-col gap-1 lg:flex-none">
            <div className="h-6 w-56 rounded-control bg-sunken lg:h-9" />
            <div className={`${SKELETON_LINE} w-32`} />
          </div>
        </HeaderFrame>
      }
    />
  );
}
