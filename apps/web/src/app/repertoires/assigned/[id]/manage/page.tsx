import type { JSX } from 'react';
import { z } from 'zod';
import { FORK_PARAM } from '../../../../../lib/routes';
import { assignedManageData } from '../../../../../server/assignment-pages';
import { forkAction } from '../actions';
import { AssignedManageScreen } from './assigned-manage-screen';

type SearchParams = Record<string, string | string[] | undefined>;

/** `?fork=1` asks "make my own copy"'s question at once; anything else does not. */
const forkParam = z.literal('1');

// The Repertoire screen of a repertoire the player has from their coach
// (R-226). The loader decides, as for the assigned page: not assigned to
// the session player now, forked, or a malformed id is 404 (plan decision
// 12; the layout above decides it before streaming).
export default async function AssignedManagePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { repertoire, paused } = await assignedManageData(id);
  const fork = forkParam.safeParse((await searchParams)[FORK_PARAM]);
  return (
    <AssignedManageScreen
      repertoire={repertoire}
      paused={paused}
      forkAction={forkAction}
      forkOpen={fork.success}
    />
  );
}
