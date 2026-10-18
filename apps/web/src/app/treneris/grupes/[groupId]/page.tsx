import type { JSX } from 'react';
import { coachGroupData } from '../../../../server/coach-pages';
import { GroupView } from './group-view';

// One of the coach's own groups (plan decision 11). Another coach's group
// and a malformed id are 404; with Coach mode off the loader sends the
// account to settings (R-113).
export default async function CoachGroupPage({
  params,
}: {
  readonly params: Promise<{ groupId: string }>;
}): Promise<JSX.Element> {
  const group = await coachGroupData((await params).groupId);
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
    />
  );
}
