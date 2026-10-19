export class PostNotFoundError extends Error {
  readonly code = "post_not_found";

  constructor() {
    super("A publicação não foi encontrada.");
    this.name = "PostNotFoundError";
  }
}

export class InvalidPostUpdateError extends Error {
  readonly code = "invalid_post";
  readonly fields: string[];

  constructor(fields: readonly string[]) {
    super("Os dados da publicação não são válidos.");
    this.name = "InvalidPostUpdateError";
    this.fields = [...fields];
  }
}

export class PostForbiddenError extends Error {
  readonly code = "post_forbidden";

  constructor() {
    super("Você não tem permissão para gerenciar esta publicação.");
    this.name = "PostForbiddenError";
  }
}

export class PostNotEditableError extends Error {
  readonly code = "post_not_editable";

  constructor() {
    super("O agendamento desta publicação não pode ser editado.");
    this.name = "PostNotEditableError";
  }
}

export class PostNotCancellableError extends Error {
  readonly code = "post_not_cancellable";

  constructor() {
    super("O agendamento desta publicação não pode ser cancelado.");
    this.name = "PostNotCancellableError";
  }
}
