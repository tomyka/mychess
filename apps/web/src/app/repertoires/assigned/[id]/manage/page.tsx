import type { JSX } from 'react';
import {
  readAssignedManageQuery,
  type SearchParams,
} from '../../../../../lib/routes';
import { assignedManageData } from '../../../../../server/assignment-pages';
import { forkAction } from '../actions';
import { AssignedManageScreen } from './assigned-manage-screen';

// The Repertoire screen of a repertoire the player has from their coach
// (R-226). The loader decides, as for the assigned page: not assigned to
// the session player now, forked, or a malformed id is 404 (plan decision
// 12; the layout above decides it before streaming). `?fork=1` asks "make
// my own copy"'s question at once.
export default async function AssignedManagePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { repertoire, paused } = await assignedManageData(id);
  const { forkOpen } = readAssignedManageQuery(await searchParams);
  return (
    <AssignedManageScreen
      repertoire={repertoire}
      paused={paused}
      forkAction={forkAction}
      forkOpen={forkOpen}
    />
  );
}
