const messages = {
  publication_unavailable: "A publicação não está disponível.",
  publication_author_unavailable: "O autor da publicação não está disponível.",
  meta_token_invalid: "A autorização da Página precisa ser renovada.",
  meta_page_unavailable: "A Página não está disponível para publicação.",
  meta_permission_denied: "A autorização não permite publicar nesta Página.",
  media_unavailable: "A mídia não está disponível para publicação.",
  meta_invalid_request: "O conteúdo não pôde ser publicado na Página.",
  meta_rate_limited: "O limite de publicações da Meta foi atingido.",
  meta_provider_error: "Não foi possível concluir a publicação na Meta.",
  meta_timeout: "A Meta não respondeu dentro do prazo de publicação.",
} as const;

export type PublicationErrorCode = keyof typeof messages;

/** Only these fixed failures may be persisted as ordinary destination failures. */
export class PublicationError extends Error {
  constructor(readonly code: PublicationErrorCode) {
    super(messages[code]);
    this.name = "PublicationError";
  }
}

/** Leave the claim publishing: a later stale sweep must resolve uncertain state. */
export class PublicationOperationalError extends Error {
  constructor() {
    super("Não foi possível confirmar o resultado da publicação.");
    this.name = "PublicationOperationalError";
  }
}
