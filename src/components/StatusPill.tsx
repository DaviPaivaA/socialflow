import type { PostStatus } from "../types/social";
import {
  getPostStatusClass,
  getPostStatusLabel,
} from "../domain/postPresentation";

type StatusPillProps = {
  status: PostStatus;
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span className={"status-pill " + getPostStatusClass(status)}>
      {getPostStatusLabel(status)}
    </span>
  );
}
