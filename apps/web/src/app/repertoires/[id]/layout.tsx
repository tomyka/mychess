import type { JSX, ReactNode } from 'react';
import { viewedRepertoire } from '../../../server/repertoires';

// Decides access before the page's loading.tsx starts streaming: a
// notFound() inside a streamed page answers 200, here it answers 404 like
// the API (#331, decision 12). The page reads the same cached load.
export default async function RepertoireLayout({
  params,
  children,
}: {
  readonly params: Promise<{ id: string }>;
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await viewedRepertoire((await params).id);
  return <>{children}</>;
}
