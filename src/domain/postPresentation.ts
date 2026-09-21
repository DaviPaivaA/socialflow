import type { ContentColor, Post, PostStatus } from "../types/social";

const STATUS_LABELS: Record<PostStatus, string> = {
  cancelled: "Cancelado",
  draft: "Rascunho",
  failed: "Falhou",
  partially_failed: "Parcialmente falhou",
  published: "Publicado",
  publishing: "Publicando",
  scheduled: "Agendado",
};

const STATUS_COLORS: Record<PostStatus, ContentColor> = {
  cancelled: "blue",
  draft: "blue",
  failed: "coral",
  partially_failed: "coral",
  published: "green",
  publishing: "coral",
  scheduled: "purple",
};

const STATUS_CLASSES: Record<PostStatus, string> = {
  cancelled: "rascunho",
  draft: "rascunho",
  failed: "rascunho",
  partially_failed: "rascunho",
  published: "publicado",
  publishing: "agendado",
  scheduled: "agendado",
};

export function getPostPresentationColor(post: Post): ContentColor {
  return STATUS_COLORS[post.status];
}

export function getPostStatusClass(status: PostStatus): string {
  return STATUS_CLASSES[status];
}

export function getPostStatusLabel(status: PostStatus): string {
  return STATUS_LABELS[status];
}

export function getPostTitle(post: Post): string {
  const title = post.title?.trim();
  if (title) return title;

  const captionTitle = post.caption.trim().split(/[.!?]/)[0]?.trim();
  return captionTitle || "Publicação sem título";
}
