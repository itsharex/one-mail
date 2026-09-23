import { useState } from "react";
import { DefaultAvatar } from "@renderer/components/default-avatar";
import { ConversationAddress } from "@renderer/shared/conversations";
import { cn } from "@renderer/lib/utils";

const logoResults = new Map<string, 'loaded' | 'failed'>();

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
  const logo = getLogoForEmail(seed);
  const imageUrl = iconUrl || (members && members.length > 1 ? null : logo?.url);
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
      {imageUrl ? (
        <LogoAvatar src={imageUrl} minSize={iconUrl || logo?.vector ? 0 : 96} enlarge={logo?.enlarge} fallback={fallback} />
      ) : (
        fallback
      )}
    </div>
  );
}

function getLogoForEmail(email: string): { url: string; vector?: boolean; enlarge?: boolean } | null {
  const domain = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim())?.[1]?.toLowerCase();
  if (!domain) return null;

  if (["163.com", "126.com", "yeah.net"].some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) {
    return { url: "https://logos.hunter.io/netease.com", enlarge: true };
  }
  if (["microsoft.com", "outlook.com", "live.com", "hotmail.com"].some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) {
    return { url: "https://api.iconify.design/logos/microsoft-icon.svg", vector: true };
  }
  if (domain === "paypal.com" || domain.endsWith(".paypal.com")) {
    return { url: "https://api.iconify.design/logos/paypal.svg", vector: true };
  }
  return { url: `https://logos.hunter.io/${domain}` };
}

function LogoAvatar({ src, minSize, enlarge, fallback }: { src: string; minSize: number; enlarge?: boolean; fallback: React.ReactNode }) {
  const cacheKey = `${src}:${minSize}`;
  const [result, setResult] = useState<{ key: string; status: 'loaded' | 'failed' } | null>(null);
  const status = result?.key === cacheKey ? result.status : logoResults.get(cacheKey);
  const showLogo = status === 'loaded';

  return (
    <div className="relative size-full overflow-hidden rounded bg-white">
      {!showLogo && fallback}
      {status !== 'failed' && <img
        key={src}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={cn("absolute inset-0 size-full rounded object-contain", enlarge && "scale-[1.2]", !showLogo && "invisible")}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          const next = naturalWidth >= minSize && naturalHeight >= minSize ? 'loaded' : 'failed';
          logoResults.set(cacheKey, next);
          setResult({ key: cacheKey, status: next });
        }}
        onError={() => {
          logoResults.set(cacheKey, 'failed');
          setResult({ key: cacheKey, status: 'failed' });
        }}
      />}
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
            {rowMembers.map((member) => {
              const logo = getLogoForEmail(member.email);
              const fallback = <DefaultAvatar seed={member.email} className="size-full rounded-[2px]" />;
              return (
                <div
                  key={member.email}
                  className={cn("shrink-0 overflow-hidden rounded-[2px]", count <= 4 ? "size-[14px]" : "size-[10px]")}
                >
                  {logo ? <LogoAvatar src={logo.url} minSize={logo.vector ? 0 : 96} enlarge={logo.enlarge} fallback={fallback} /> : fallback}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
