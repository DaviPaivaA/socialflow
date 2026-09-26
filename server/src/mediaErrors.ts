export class MediaRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MediaRequestError";
    this.status = status;
    this.code = code;
  }
}

export class MediaStorageError extends MediaRequestError {
  constructor() {
    super(500, "media_storage_error", "Não foi possível armazenar o arquivo.");
    this.name = "MediaStorageError";
  }
}

export class MediaContentUnavailableError extends MediaRequestError {
  constructor() {
    super(500, "media_content_unavailable", "Não foi possível acessar o conteúdo da mídia.");
    this.name = "MediaContentUnavailableError";
  }
}
