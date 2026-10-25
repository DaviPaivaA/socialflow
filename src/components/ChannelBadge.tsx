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
      role="img"
    >
      {code === "TT" ? (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          <path fill="#25f4ee" transform="translate(-1 1)" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
          <path fill="#fe2c55" transform="translate(1 -1)" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
          <path fill="#fff" d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1v7a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z" />
        </svg>
      ) : code === "IG" ? (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      ) : code === "FB" ? (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          <path fill="currentColor" d="M14 22v-9h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.4A25 25 0 0 0 15 1c-3 0-5 1.8-5 5v3H7v4h3v9Z" />
        </svg>
      ) : code}
    </span>
  );
}
