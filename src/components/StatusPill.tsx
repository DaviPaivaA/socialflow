import type { PostStatus } from "../types/social";

type StatusPillProps = {
  status: PostStatus;
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span className={"status-pill " + status.toLowerCase()}>{status}</span>
  );
}
