import type { JSX } from 'react';
import { coachGroupData } from '../../../../server/coach-pages';
import { GroupView } from './group-view';

// One of the coach's own groups (plan decision 11): its progress (R-153),
// what is assigned to it and its invite link (R-232), from the loader.
// Another coach's group and a malformed id are 404; with Coach mode off
// the loader sends the account to settings (R-113).
export default async function CoachGroupPage({
  params,
}: {
  readonly params: Promise<{ groupId: string }>;
}): Promise<JSX.Element> {
  const read = await coachGroupData((await params).groupId);
  return (
    <GroupView
      page={{
        id: read.id,
        name: read.name,
        members: read.members.map(({ id, displayName }) => ({
          id,
          displayName,
        })),
        addable: read.addable,
        grid: read.grid,
        assignments: read.assignments,
        invite: read.invite,
        today: read.today,
      }}
    />
  );
}
