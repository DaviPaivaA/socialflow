import { describe, expect, it } from "vitest";
import { isPost, validateCreatePost } from "../src/postContract.ts";

const validInput = {
  caption: "Conteúdo persistido.",
  publicationMode: "scheduled",
  scheduledFor: "2027-08-13T13:00:00.000Z",
  socialAccountIds: ["66666666-6666-4666-8666-666666666666"],
  title: "Publicação válida",
} as const;
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";

const validPost = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  caption: validInput.caption,
  createdAt: "2027-08-10T13:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  mediaAssetIds: [],
  publishedAt: null,
  ragRunId: null,
  scheduledFor: validInput.scheduledFor,
  status: "scheduled",
  tenantId: "11111111-1111-4111-8111-111111111111",
  title: validInput.title,
  updatedAt: "2027-08-10T13:00:00.000Z",
};

describe("contrato oficial de publicação", () => {
  it("aceita o DTO de criação com uma Page e sem estado persistido", () => {
    expect(validateCreatePost(validInput)).toEqual({
      success: true,
      data: { ...validInput, mediaAssetIds: [] },
    });
  });

  it("normaliza ausência ou lista vazia de mediaAssetIds", () => {
    for (const input of [validInput, { ...validInput, mediaAssetIds: [] }]) {
      expect(validateCreatePost(input)).toEqual({
        success: true,
        data: { ...validInput, mediaAssetIds: [] },
      });
    }
  });

  it("aceita uma mídia no DTO de criação", () => {
    expect(validateCreatePost({ ...validInput, mediaAssetIds: [MEDIA_ID] })).toEqual({
      success: true,
      data: { ...validInput, mediaAssetIds: [MEDIA_ID] },
    });
  });

  it.each([
    ["ausência", { socialAccountIds: undefined }],
    ["lista vazia", { socialAccountIds: [] }],
    ["UUID inválido", { socialAccountIds: ["page-1"] }],
    ["duplicata", { socialAccountIds: [validInput.socialAccountIds[0], validInput.socialAccountIds[0]] }],
  ])("rejeita socialAccountIds com %s", (_label, patch) => {
    expect(validateCreatePost({ ...validInput, ...patch })).toEqual({
      success: false,
      fields: ["socialAccountIds"],
    });
  });

  it("rejeita modo de publicação inválido", () => {
    expect(validateCreatePost({ ...validInput, publicationMode: "draft" })).toEqual({
      success: false,
      fields: ["publicationMode"],
    });
  });

  it("exige scheduledFor somente para modo scheduled", () => {
    expect(validateCreatePost({ ...validInput, scheduledFor: undefined })).toEqual({
      success: false,
      fields: ["scheduledFor"],
    });
    expect(validateCreatePost({ ...validInput, publicationMode: "now" })).toEqual({
      success: false,
      fields: ["scheduledFor"],
    });
  });

  it("normaliza o modo now para scheduledFor null", () => {
    const { scheduledFor: _scheduledFor, ...input } = validInput;
    void _scheduledFor;
    expect(validateCreatePost({ ...input, publicationMode: "now" })).toEqual({
      success: true,
      data: { ...input, publicationMode: "now", scheduledFor: null, mediaAssetIds: [] },
    });
  });

  it("rejeita status fornecido pelo frontend mesmo quando scheduled", () => {
    expect(validateCreatePost({ ...validInput, status: "scheduled" })).toEqual({
      success: false,
      fields: ["status"],
    });
  });

  it.each([
    ["null", null],
    ["string", MEDIA_ID],
    ["uuid inválido", ["media-invalida"]],
    ["duas mídias", [MEDIA_ID, "55555555-5555-4555-8555-555555555555"]],
    ["ids duplicados", [MEDIA_ID, MEDIA_ID]],
  ])("rejeita mediaAssetIds %s", (_label, mediaAssetIds) => {
    expect(validateCreatePost({ ...validInput, mediaAssetIds })).toEqual({
      success: false,
      fields: ["mediaAssetIds"],
    });
  });

  it("exige mediaAssetIds válido no Post público", () => {
    expect(isPost(validPost)).toBe(true);
    const { mediaAssetIds: _removed, ...withoutMedia } = validPost;
    void _removed;
    expect(isPost(withoutMedia)).toBe(false);
    expect(isPost({ ...validPost, mediaAssetIds: [MEDIA_ID] })).toBe(true);
    expect(isPost({ ...validPost, mediaAssetIds: ["invalid"] })).toBe(false);
    expect(isPost({ ...validPost, mediaAssetIds: [MEDIA_ID, MEDIA_ID] })).toBe(false);
  });

  it.each([
    ["corpo não objeto", null, ["body"]],
    [
      "data impossível",
      { ...validInput, scheduledFor: "2027-02-30T10:00:00-03:00" },
      ["scheduledFor"],
    ],
    [
      "agendamento sem fuso",
      { ...validInput, scheduledFor: "2027-08-13T10:00:00" },
      ["scheduledFor"],
    ],
    [
      "offset fora do domínio ISO persistido",
      { ...validInput, scheduledFor: "2027-08-13T10:00:00+16:00" },
      ["scheduledFor"],
    ],
    [
      "instante normalizado fora do domínio do DTO",
      { ...validInput, scheduledFor: "9999-12-31T23:59:59-03:00" },
      ["scheduledFor"],
    ],
    ["título vazio", { ...validInput, title: "   " }, ["title"]],
    ["legenda vazia", { ...validInput, caption: "" }, ["caption"]],
    ["status não criável", { ...validInput, status: "published" }, ["status"]],
  ])("rejeita %s", (_label, value, fields) => {
    expect(validateCreatePost(value)).toEqual({ success: false, fields });
  });

  it("valida UUIDs e o contrato completo retornado pela API", () => {
    expect(isPost(validPost)).toBe(true);
    expect(isPost({ ...validPost, id: 7 })).toBe(false);
    expect(isPost({ ...validPost, tenantId: "tenant-a" })).toBe(false);
    expect(isPost({ ...validPost, authorUserId: null })).toBe(false);
  });

  it("aceita os limites representáveis com offset ISO válido", () => {
    expect(
      validateCreatePost({
        ...validInput,
        scheduledFor: "9999-12-31T23:59:59.999Z",
      }),
    ).toEqual({
      data: {
        ...validInput,
        mediaAssetIds: [],
        scheduledFor: "9999-12-31T23:59:59.999Z",
      },
      success: true,
    });
    expect(
      validateCreatePost({
        ...validInput,
        scheduledFor: "2027-08-13T10:00:00+14:00",
      }).success,
    ).toBe(true);
  });
});
