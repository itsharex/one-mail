import { DefaultAvatar } from "@renderer/components/default-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@renderer/components/ui/avatar";
import { ConversationAddress } from "@renderer/shared/conversations";
import { cn } from "@renderer/lib/utils";

export function ConversationAvatar({
  seed,
  members,
  iconUrl,
  outgoing = false,
  compact = false,
}: {
  seed: string;
  members?: ConversationAddress[];
  iconUrl?: string | null;
  outgoing?: boolean;
  compact?: boolean;
}) {
  const fallback =
    members && members.length > 1 ? (
      <GroupAvatar members={members} />
    ) : (
      <DefaultAvatar seed={seed} className="size-full rounded" />
    );

  return (
    <div
      aria-hidden="true"
      className={cn(
        "conversation-avatar flex shrink-0 items-center justify-center rounded text-base font-medium",
        compact ? "size-9" : "size-10",
        outgoing && "is-outgoing",
      )}
    >
      {iconUrl ? (
        <Avatar className="size-full rounded after:rounded">
          <AvatarImage src={iconUrl} className="rounded" />
          <AvatarFallback className="rounded bg-transparent">
            {fallback}
          </AvatarFallback>
        </Avatar>
      ) : (
        fallback
      )}
    </div>
  );
}

function GroupAvatar({ members }: { members: ConversationAddress[] }) {
  const visible = members.slice(0, 9);
  const count = visible.length;
  const rowSizes =
    count <= 2
      ? [count]
      : count === 3
        ? [1, 2]
        : count === 4
          ? [2, 2]
          : count === 5
            ? [2, 3]
            : count === 6
              ? [3, 3]
              : count === 7
                ? [1, 3, 3]
                : count === 8
                  ? [2, 3, 3]
                  : [3, 3, 3];
  let offset = 0;

  return (
    <div className="conversation-group-avatar flex size-full flex-col items-center justify-center gap-[2px] overflow-hidden rounded">
      {rowSizes.map((size, row) => {
        const rowMembers = visible.slice(offset, offset + size);
        offset += size;
        return (
          <div key={row} className="flex justify-center gap-[2px]">
            {rowMembers.map((member) => (
              <DefaultAvatar
                key={member.email}
                seed={member.email}
                className={cn(
                  "rounded-[2px]",
                  count <= 4 ? "size-[14px]" : "size-[10px]",
                )}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
