import type { JSX } from 'react';
import { RepertoireLoadingShell } from '../../../repertoire-view';

// An assigned repertoire while it loads (docs/design/repertoire-screen.md,
// States): the repertoire page's loading shell, its top bar's skeleton
// included, so the board does not jump when the page arrives. The layout
// decides access first, so a 404 is not streamed (#331).
export default function AssignedRepertoireLoading(): JSX.Element {
  return <RepertoireLoadingShell />;
}
