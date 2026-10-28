import type { JSX } from 'react';
import { coachGroupData } from '../../../../server/coach-pages';
import { GroupView } from './group-view';

// One of the coach's own groups (plan decision 11) and its progress grid
// (R-153), from one read. Another coach's group and a malformed id are
// 404; with Coach mode off the loader sends the account to settings
// (R-113).
export default async function CoachGroupPage({
  params,
}: {
  readonly params: Promise<{ groupId: string }>;
}): Promise<JSX.Element> {
  const { id, name, members, addable, grid } = await coachGroupData(
    (await params).groupId,
  );
  return (
    <GroupView
      group={{
        id,
        name,
        members: members.map(({ id: memberId, displayName }) => ({
          id: memberId,
          displayName,
        })),
        addable,
      }}
      grid={grid}
    />
  );
}
