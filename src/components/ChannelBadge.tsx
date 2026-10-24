import { channelMeta } from "../data/mockData";
import type { ChannelCode } from "../types/social";

type ChannelBadgeProps = {
  code: ChannelCode;
  small?: boolean;
};

export function ChannelBadge({ code, small = false }: ChannelBadgeProps) {
  const channel = channelMeta[code];

  return (
    <span
      className={"channel-badge " + (small ? "small" : "")}
      style={{ backgroundColor: channel.color }}
      title={channel.name}
      aria-label={channel.name}
      role={code === "TT" ? "img" : undefined}
    >
      {code === "TT" ? (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          <path fill="#25f4ee" transform="translate(-1 1)" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
          <path fill="#fe2c55" transform="translate(1 -1)" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
          <path fill="#fff" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
        </svg>
      ) : code}
    </span>
  );
}
