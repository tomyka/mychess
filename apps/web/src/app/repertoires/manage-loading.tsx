import type { JSX } from 'react';
import { SKELETON_LINE } from '../repertoire-view';
import { CONTENT } from '../surfaces';

const SECTION_SKELETON = 'h-32 rounded-card bg-sunken';

/**
 * A Repertoire screen while it loads (docs/design/repertoire-screen.md,
 * States): the title's line, then a skeleton per section. No spinner.
 */
export function ManageLoading(): JSX.Element {
  return (
    <main aria-busy="true" className={`${CONTENT} gap-8`}>
      <div aria-hidden="true" className="flex min-h-touch items-center">
        <div className={`${SKELETON_LINE} h-8 w-64`} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className={SECTION_SKELETON} />
        <div className={SECTION_SKELETON} />
        <div className={SECTION_SKELETON} />
      </div>
    </main>
  );
}
