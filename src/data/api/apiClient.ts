type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

type ParsedResponseBody = {
  body: unknown;
  parseError?: unknown;
};

export type ApiResponse<T> = {
  body: T | undefined;
  status: number;
};

export class HttpError extends Error {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;

  constructor(response: Response, url: string, body: unknown) {
    const suffix = response.statusText ? ` ${response.statusText}` : "";
    super(`Erro HTTP ${response.status}${suffix}`);
    this.name = "HttpError";
    this.body = body;
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = url;
  }
}

export class JsonParseError extends Error {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`Resposta JSON inválida recebida de ${url}.`, { cause });
    this.name = "JsonParseError";
    this.url = url;
  }
}

function buildUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

function isJsonContentType(contentType: string | null) {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();

  return mediaType === "application/json" || mediaType?.endsWith("+json");
}

async function parseResponseBody(
  response: Response,
): Promise<ParsedResponseBody> {
  if (response.status === 204 || response.status === 205) {
    return { body: undefined };
  }

  const text = await response.text();
  if (!text) return { body: undefined };

  if (isJsonContentType(response.headers.get("content-type"))) {
    try {
      return { body: JSON.parse(text) as unknown };
    } catch (parseError) {
      return { body: text, parseError };
    }
  }

  return { body: text };
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, fetchImpl = globalThis.fetch }: ApiClientOptions) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  private async requestResponse<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    const url = buildUrl(this.baseUrl, path);
    const headers = new Headers(init.headers);

    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    const response = await this.fetchImpl(url, {
      ...init,
      credentials: init.credentials ?? "include",
      headers,
    });
    const { body, parseError } = await parseResponseBody(response);

    if (!response.ok) throw new HttpError(response, url, body);
    if (parseError !== undefined) throw new JsonParseError(url, parseError);

    return { body: body as T | undefined, status: response.status };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.requestResponse<T>(path, init);

    return response.body as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  getResponse<T>(path: string): Promise<ApiResponse<T>> {
    return this.requestResponse<T>(path, { method: "GET" });
  }

  post<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
    return this.request<TResponse>(path, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  }

  patch<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
    return this.request<TResponse>(path, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
  }

  delete<TResponse>(path: string): Promise<TResponse> {
    return this.request<TResponse>(path, { method: "DELETE" });
  }
}
