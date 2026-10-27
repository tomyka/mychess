import type { JSX } from 'react';
import { coachGroupData } from '../../../../server/coach-pages';
import { groupProgressData } from '../../../../server/coach-progress';
import { GroupView } from './group-view';

// One of the coach's own groups (plan decision 11) and its progress grid
// (R-153). Another coach's group and a malformed id are 404; with Coach
// mode off the loaders send the account to settings (R-113).
export default async function CoachGroupPage({
  params,
}: {
  readonly params: Promise<{ groupId: string }>;
}): Promise<JSX.Element> {
  const { groupId } = await params;
  const [group, grid] = await Promise.all([
    coachGroupData(groupId),
    groupProgressData(groupId),
  ]);
  return (
    <GroupView
      group={{
        id: group.id,
        name: group.name,
        members: group.members.map(({ id, displayName }) => ({
          id,
          displayName,
        })),
        addable: group.addable,
      }}
      grid={grid}
    />
  );
}
