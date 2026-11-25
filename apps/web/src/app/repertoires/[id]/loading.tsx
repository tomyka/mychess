import type { JSX } from 'react';
import { RepertoireLoadingShell, SKELETON_LINE } from '../../repertoire-view';

// The repertoire page while it loads (docs/design/repertoire-screen.md,
// States): the top bar's skeleton over the shared loading shell.
export default function RepertoireLoading(): JSX.Element {
  return (
    <RepertoireLoadingShell
      header={
        <div className="flex min-h-14 items-center px-gutter lg:px-0">
          <div className={`${SKELETON_LINE} w-48`} />
        </div>
      }
    />
  );
}
