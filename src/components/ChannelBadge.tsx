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
    >
      {code}
    </span>
  );
}
