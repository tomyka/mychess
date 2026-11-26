import type { JSX } from 'react';
import { RepertoireLoadingShell } from '../../repertoire-view';

// The repertoire page while it loads (docs/design/repertoire-screen.md,
// States): the shared loading shell, which draws the top bar's skeleton
// itself.
export default function RepertoireLoading(): JSX.Element {
  return <RepertoireLoadingShell />;
}
