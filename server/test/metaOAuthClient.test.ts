import { describe, expect, it, vi } from "vitest";
import {
  HttpMetaOAuthClient,
  META_OAUTH_SCOPES,
  MetaOAuthClientError,
  type EnabledMetaOAuthConfig,
} from "../src/metaOAuthClient.ts";

const config: EnabledMetaOAuthConfig = {
  appId: "123456789012345",
  appSecret: "a".repeat(32),
  enabled: true,
  graphApiVersion: "v26.0",
  redirectUri: "http://localhost:3001/auth/meta/callback",
  stateTtlSeconds: 600,
};

const state = "s".repeat(43);

function clientWith(fetchImpl: typeof fetch, timeoutMs = 1_000) {
  return new HttpMetaOAuthClient(config, {
    fetchImpl,
    now: () => Date.parse("2026-09-20T12:00:00.000Z"),
    timeoutMs,
  });
}

describe("HttpMetaOAuthClient", () => {
  it("cria URL versionada com somente os três scopes de descoberta", () => {
    const client = clientWith(vi.fn<typeof fetch>());
    const url = new URL(client.buildAuthorizationUrl(state));

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe(config.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("scope")?.split(",")).toEqual(
      META_OAUTH_SCOPES,
    );
    for (const forbidden of [
      "pages_manage_posts",
      "instagram_content_publish",
      "instagram_manage_insights",
      "instagram_manage_comments",
      "instagram_manage_messages",
    ]) {
      expect(url.searchParams.get("scope")).not.toContain(forbidden);
    }
  });

  it("troca code e token curto no backend usando endpoints versionados", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "short-token", expires_in: 3_600 }),
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: "long-token", expires_in: 7_200 }),
      );
    const client = clientWith(fetchMock);

    await expect(client.exchangeCode("authorization-code")).resolves.toEqual({
      accessToken: "short-token",
      expiresAt: "2026-09-20T13:00:00.000Z",
    });
    await expect(
      client.exchangeForLongLivedToken("short-token"),
    ).resolves.toEqual({
      accessToken: "long-token",
      expiresAt: "2026-09-20T14:00:00.000Z",
    });

    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toBe(
        "https://graph.facebook.com/v26.0/oauth/access_token",
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(URLSearchParams);
    }
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "code=authorization-code",
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "grant_type=fb_exchange_token",
    );
  });

  it("consulta identidade e permissões com Bearer e appsecret_proof", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "123456" }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { permission: "pages_show_list", status: "granted" },
            { permission: "instagram_basic", status: "declined" },
            { permission: "pages_read_engagement", status: "expired" },
          ],
        }),
      );
    const client = clientWith(fetchMock);

    await expect(client.getIdentity("user-token")).resolves.toEqual({
      id: "123456",
    });
    await expect(client.getPermissions("user-token")).resolves.toEqual([
      { name: "pages_show_list", status: "granted" },
      { name: "instagram_basic", status: "declined" },
      { name: "pages_read_engagement", status: "expired" },
    ]);

    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.facebook.com");
      expect(url.pathname.startsWith("/v26.0/")).toBe(true);
      expect(url.searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.has("access_token")).toBe(false);
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer user-token",
      );
    }
  });

  it("pagina Pages por cursor reconstruindo sempre a URL Meta fixa", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              access_token: "page-token-1",
              id: "1001",
              name: "Page A",
              tasks: ["ANALYZE"],
            },
          ],
          paging: {
            cursors: { after: "cursor-seguro" },
            next: "https://evil.example/nao-seguir",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              access_token: "page-token-2",
              id: "1002",
              instagram_business_account: { id: "2002" },
              name: "Page B",
              picture: { data: { url: "https://cdn.example/page-b.png" } },
              tasks: [],
              username: "page_b",
            },
          ],
        }),
      );
    const client = clientWith(fetchMock);

    await expect(client.listPages("user-token")).resolves.toEqual([
      {
        accessToken: "page-token-1",
        id: "1001",
        instagramBusinessAccountId: null,
        name: "Page A",
        profileImageUrl: null,
        tasks: ["ANALYZE"],
        username: null,
      },
      {
        accessToken: "page-token-2",
        id: "1002",
        instagramBusinessAccountId: "2002",
        name: "Page B",
        profileImageUrl: "https://cdn.example/page-b.png",
        tasks: [],
        username: "page_b",
      },
    ]);
    const nextUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(nextUrl.origin).toBe("https://graph.facebook.com");
    expect(nextUrl.pathname).toBe("/v26.0/me/accounts");
    expect(nextUrl.searchParams.get("after")).toBe("cursor-seguro");
    expect(nextUrl.searchParams.get("fields")).toContain("username");
  });

  it("interrompe paginação com cursor repetido", async () => {
    const page = {
      data: [],
      paging: {
        cursors: { after: "cursor-repetido" },
        next: "https://graph.facebook.com/proxima",
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json(page));

    await expect(clientWith(fetchMock).listPages("user-token")).rejects.toMatchObject(
      { kind: "invalid_response", requestName: "pages" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normaliza Instagram Professional sem aceitar consumer implícito", async () => {
    const client = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: "2002",
          name: "Instagram Pro",
          profile_picture_url: "https://cdn.example/ig.png",
          username: "instagram_pro",
        }),
      ),
    );

    await expect(
      client.getInstagramAccount("2002", "page-token"),
    ).resolves.toEqual({
      displayName: "Instagram Pro",
      id: "2002",
      profileImageUrl: "https://cdn.example/ig.png",
      username: "instagram_pro",
    });
  });

  it("rejeita token ausente, erro Graph e JSON malformado", async () => {
    const missingPageToken = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ data: [{ id: "1001", name: "Page" }] }),
      ),
    );
    await expect(missingPageToken.listPages("user-token")).rejects.toBeInstanceOf(
      MetaOAuthClientError,
    );

    const graphError = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { error: { code: 190, message: "raw provider detail" } },
          { status: 400 },
        ),
      ),
    );
    await expect(graphError.getIdentity("user-token")).rejects.toMatchObject({
      graphCode: "190",
      kind: "graph",
      requestName: "identity",
    });

    const invalidJson = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("não-json", { status: 200 }),
      ),
    );
    await expect(invalidJson.getPermissions("user-token")).rejects.toMatchObject(
      { kind: "invalid_response" },
    );
  });

  it("interrompe chamadas que excedem o timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    const client = clientWith(fetchMock, 5);

    await expect(client.getIdentity("user-token")).rejects.toMatchObject({
      kind: "timeout",
      requestName: "identity",
    });
  });
});
