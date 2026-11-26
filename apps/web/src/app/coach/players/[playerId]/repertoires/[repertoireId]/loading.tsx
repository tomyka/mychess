import type { JSX } from 'react';
import { RepertoireLoadingShell } from '../../../../../repertoire-view';

// The coach's read-only view of a shared repertoire while it loads
// (docs/design/coach-shared-repertoire.md, States): the repertoire page's
// loading shell, its top bar's skeleton included, so the board does not
// jump when the page arrives.
export default function SharedRepertoireLoading(): JSX.Element {
  return <RepertoireLoadingShell />;
}
