import type { JSX, ReactNode } from 'react';
import { viewedAssignedRepertoire } from '../../../../server/assignment-pages';

// Decides access before the page's loading.tsx starts streaming: a
// notFound() inside a streamed page answers 200, here it answers 404
// (#331, plan decision 12). The page reads the same cached load.
export default async function AssignedRepertoireLayout({
  params,
  children,
}: {
  readonly params: Promise<{ id: string }>;
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await viewedAssignedRepertoire((await params).id);
  return <>{children}</>;
}
