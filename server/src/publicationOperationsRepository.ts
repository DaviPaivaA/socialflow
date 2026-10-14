import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClaimedPublication } from "./postPublicationsRepository.ts";
import type { PostsContext } from "./postsContext.ts";

export type MediaDeliveryBinding = PostsContext & {
  socialAccountId: string; providerAccountId: string; kind: "instagram_image" | "instagram_reel";
  issuedAt: Date; expiresAt: Date; deadlineAt: Date;
};

export type PublicationOperationKind = "facebook_reel" | "instagram_image" | "instagram_reel";
export type PublicationOperationStage = "prepared" | "creating" | "created" | "uploading" | "processing" |
  "ready" | "publishing" | "verifying" | "succeeded" | "failed" | "unknown";
export type LeasedPublicationOperation = {
  tenantId: string; publicationId: string; mediaAssetId: string; kind: PublicationOperationKind;
  stage: PublicationOperationStage; providerAccountId: string; graphApiVersion: string; externalId: string | null;
  leaseToken: string; leaseExpiresAt: Date; nextActionAt: Date | null; deadlineAt: Date; stageStartedAt: Date;
  pollCount: number; deliveryIssuedAt: Date | null; deliveryExpiresAt: Date | null; createdAt: Date; updatedAt: Date;
};
type Checkpoint = {
  lease: LeasedPublicationOperation; expectedStage: PublicationOperationStage; nextStage: PublicationOperationStage;
  externalId?: string; nextActionAt: Date | null; delivery?: { issuedAt: Date; expiresAt: Date };
};
type Completion = {
  lease: LeasedPublicationOperation; now: Date; result:
    { status: "published"; providerPostId: string | null } |
    { status: "failed"; code: string; message: string; unknown: boolean };
};

/** Must run on the same transaction/client that claims the destination. No credentials or I/O here. */
export async function preparePublicationOperation(client: PoolClient, target: ClaimedPublication,
  input: { graphApiVersion: string; now: Date }): Promise<void> {
  const result = await client.query(`SELECT account.account_type, account.external_account_id,
      post.author_user_id, media.id AS media_asset_id, media.media_type
    FROM post_publications destination
    JOIN posts post ON post.tenant_id=destination.tenant_id AND post.id=destination.post_id
    JOIN social_accounts account ON account.tenant_id=destination.tenant_id AND account.id=destination.social_account_id
    LEFT JOIN post_media binding ON binding.tenant_id=post.tenant_id AND binding.post_id=post.id
    LEFT JOIN media_assets media ON media.tenant_id=binding.tenant_id AND media.id=binding.media_asset_id
    WHERE destination.tenant_id=$1 AND destination.id=$2 AND destination.post_id=$3
      AND destination.social_account_id=$4 AND destination.status='publishing'`,
  [target.tenantId, target.id, target.postId, target.socialAccountId]);
  if (result.rows.length !== 1) throw new Error("Vínculo persistido da publicação inválido.");
  const row = result.rows[0];
  // Compatibility/auth failures belong to the publishing service after the durable claim,
  // not here: rolling those back would leave an ineligible scheduled destination forever.
  if (!row.media_asset_id) return;
  const kind = row.account_type === "instagram_business"
    ? row.media_type === "video" ? "instagram_reel" : "instagram_image"
    : row.account_type === "facebook_page" && row.media_type === "video" ? "facebook_reel" : null;
  if (!kind) return;
  await client.query(`INSERT INTO publication_operations (
    tenant_id,publication_id,media_asset_id,kind,stage,provider_account_id,graph_api_version,
    next_action_at,deadline_at,stage_started_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'prepared',$5,$6,$7,$7::timestamptz+interval '30 minutes',$7,$7,$7)
    ON CONFLICT (tenant_id,publication_id) DO NOTHING`,
  [target.tenantId, target.id, row.media_asset_id, kind, row.external_account_id, input.graphApiVersion, input.now]);
}

function mapLease(row: Record<string, unknown>): LeasedPublicationOperation {
  return {
    tenantId: row.tenant_id as string, publicationId: row.publication_id as string, mediaAssetId: row.media_asset_id as string,
    kind: row.kind as PublicationOperationKind, stage: row.stage as PublicationOperationStage,
    providerAccountId: row.provider_account_id as string, graphApiVersion: row.graph_api_version as string,
    externalId: row.external_id as string | null, leaseToken: row.lease_token as string, leaseExpiresAt: row.lease_expires_at as Date,
    nextActionAt: row.next_action_at as Date | null, deadlineAt: row.deadline_at as Date, stageStartedAt: row.stage_started_at as Date,
    pollCount: row.poll_count as number, deliveryIssuedAt: row.delivery_issued_at as Date | null,
    deliveryExpiresAt: row.delivery_expires_at as Date | null, createdAt: row.created_at as Date, updatedAt: row.updated_at as Date,
  };
}

function allowsTransition(kind: PublicationOperationKind, current: PublicationOperationStage, next: PublicationOperationStage): boolean {
  if (current === "prepared") return next === "creating";
  if (current === "creating") return next === "created";
  if (current === "created") return next === (kind === "facebook_reel" ? "uploading" : "processing");
  if (current === "uploading") return kind === "facebook_reel" && (next === "processing" || next === "uploading");
  if (current === "processing") return next === "ready" || next === "processing";
  if (current === "ready") return next === "publishing";
  if (current === "publishing") return next === "verifying";
  return current === "verifying" && next === "verifying";
}

const TERMINAL = ["succeeded", "failed", "unknown"];
class DestinationNotPublishing extends Error {}

export class PostgresPublicationOperationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async findDeliveryBinding(publicationId: string, assetId: string): Promise<MediaDeliveryBinding | null> {
    const result = await this.pool.query(`SELECT operation.kind,operation.provider_account_id,
        operation.delivery_issued_at,operation.delivery_expires_at,operation.deadline_at,
        post.tenant_id,post.author_user_id,destination.social_account_id
      FROM publication_operations operation
      JOIN post_publications destination ON destination.tenant_id=operation.tenant_id AND destination.id=operation.publication_id
      JOIN posts post ON post.tenant_id=destination.tenant_id AND post.id=destination.post_id
      JOIN post_media binding ON binding.tenant_id=post.tenant_id AND binding.post_id=post.id AND binding.media_asset_id=operation.media_asset_id
      JOIN media_assets asset ON asset.tenant_id=binding.tenant_id AND asset.id=binding.media_asset_id
      JOIN tenant_members member ON member.tenant_id=post.tenant_id AND member.user_id=post.author_user_id
      JOIN users author ON author.id=member.user_id AND author.is_active=true
      JOIN social_accounts account ON account.tenant_id=destination.tenant_id AND account.id=destination.social_account_id
      JOIN oauth_connections connection ON connection.tenant_id=account.tenant_id AND connection.id=account.oauth_connection_id
      WHERE operation.publication_id=$1::uuid AND operation.media_asset_id=$2::uuid
        AND operation.kind IN ('instagram_image','instagram_reel') AND operation.stage NOT IN ('succeeded','failed','unknown')
        AND destination.status='publishing' AND asset.deleted_at IS NULL
        AND operation.delivery_issued_at IS NOT NULL AND operation.delivery_expires_at IS NOT NULL
        AND account.account_type='instagram_business' AND account.is_active=true AND account.disconnected_at IS NULL
        AND account.external_account_id=operation.provider_account_id
        AND connection.platform='meta' AND connection.status='active' AND connection.revoked_at IS NULL`, [publicationId, assetId]);
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, authorUserId: row.author_user_id, socialAccountId: row.social_account_id,
      providerAccountId: row.provider_account_id, kind: row.kind, issuedAt: row.delivery_issued_at,
      expiresAt: row.delivery_expires_at, deadlineAt: row.deadline_at } : null;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async claimAction(input: { tenantId: string; publicationId: string; now: Date }): Promise<LeasedPublicationOperation | null> {
    return (await this.claim(input.now, 1, input.tenantId, input.publicationId))[0] ?? null;
  }

  async claimDueActions(now: Date, limit: number): Promise<LeasedPublicationOperation[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Limite de operações inválido.");
    return this.claim(now, limit, null, null);
  }

  async hasOperation(tenantId: string, publicationId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2", [tenantId, publicationId]);
    return result.rowCount === 1;
  }

  async claimPostActions(tenantId: string, postId: string, now: Date, limit: number): Promise<LeasedPublicationOperation[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Limite de operações inválido.");
    return this.claim(now, limit, tenantId, null, postId);
  }

  /** Terminal reconciliation is independent of poll scheduling and local execution capacity. */
  async sweepExpired(now: Date): Promise<Array<{ tenantId: string; postId: string }>> {
    return this.transaction(async client => {
      const candidates = await client.query(`SELECT operation.tenant_id,operation.publication_id,operation.stage,destination.post_id
        FROM publication_operations operation
        JOIN post_publications destination ON destination.tenant_id=operation.tenant_id AND destination.id=operation.publication_id
        WHERE destination.status='publishing' AND operation.stage NOT IN ('succeeded','failed','unknown')
          AND (operation.lease_expires_at IS NULL OR operation.lease_expires_at<=clock_timestamp())
          AND (operation.deadline_at<=$1 OR
            (operation.stage='creating' AND operation.stage_started_at<=$1::timestamptz-interval '10 minutes') OR
            (operation.stage IN ('uploading','processing','publishing','verifying') AND operation.poll_count>=30))
        ORDER BY operation.deadline_at,operation.tenant_id,operation.publication_id
        FOR UPDATE OF operation,destination SKIP LOCKED`, [now]);
      const affected: Array<{ tenantId: string; postId: string }> = [];
      for (const row of candidates.rows) {
        const unknown = ["creating", "publishing", "verifying"].includes(row.stage);
        const updated = await client.query(`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE publication_operations SET stage=$3,stage_started_at=instant.at,updated_at=instant.at,
            lease_token=NULL,lease_expires_at=NULL,next_action_at=NULL
          FROM instant WHERE tenant_id=$1 AND publication_id=$2 AND stage=$4
            AND (lease_expires_at IS NULL OR lease_expires_at<=instant.at) RETURNING publication_id`,
        [row.tenant_id, row.publication_id, unknown ? "unknown" : "failed", row.stage]);
        if (updated.rowCount !== 1) continue;
        await client.query(`UPDATE post_publications SET status='failed',error_code=$3,error_message=$4,failed_at=$5,updated_at=$5
          WHERE tenant_id=$1 AND id=$2 AND status='publishing'`, [row.tenant_id, row.publication_id,
          unknown ? "publication_state_unknown" : "meta_processing_timeout",
          unknown ? "Não foi possível confirmar o resultado da publicação." : "A mídia não ficou pronta dentro do prazo de publicação.", now]);
        affected.push({ tenantId: row.tenant_id, postId: row.post_id });
      }
      return affected;
    });
  }

  private async claim(now: Date, limit: number, tenantId: string | null, publicationId: string | null, postId: string | null = null): Promise<LeasedPublicationOperation[]> {
    return this.transaction(async client => {
      const candidates = await client.query(`SELECT operation.* FROM publication_operations operation
        JOIN post_publications destination ON destination.tenant_id=operation.tenant_id AND destination.id=operation.publication_id
        WHERE operation.stage NOT IN ('succeeded','failed','unknown') AND destination.status='publishing'
          AND (operation.lease_expires_at IS NULL OR operation.lease_expires_at <= clock_timestamp())
          AND (operation.stage='ready' OR operation.next_action_at <= $1 OR
            (operation.next_action_at IS NULL AND operation.lease_expires_at <= clock_timestamp()))
          AND ($3::uuid IS NULL OR operation.tenant_id=$3) AND ($4::uuid IS NULL OR operation.publication_id=$4)
          AND ($5::uuid IS NULL OR destination.post_id=$5)
        ORDER BY COALESCE(operation.next_action_at,operation.lease_expires_at),operation.tenant_id,operation.publication_id
        LIMIT $2 FOR UPDATE OF operation SKIP LOCKED`, [now, limit, tenantId, publicationId, postId]);
      const leased: LeasedPublicationOperation[] = [];
      for (const row of candidates.rows) {
        const seconds = row.stage === "prepared" || row.stage === "ready" || (row.stage === "created" && row.kind === "facebook_reel") ? 330 : 30;
        const result = await client.query(`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE publication_operations SET lease_token=$3,lease_expires_at=instant.at+($4 * interval '1 second'),updated_at=instant.at
          FROM instant WHERE tenant_id=$1 AND publication_id=$2 RETURNING publication_operations.*`,
        [row.tenant_id, row.publication_id, randomUUID(), seconds]);
        leased.push(mapLease(result.rows[0]));
      }
      return leased;
    });
  }

  /** Persist a conservative GET reservation before calling status outside the transaction. */
  async reserveStatusPoll(input: { lease: LeasedPublicationOperation; expectedStage: PublicationOperationStage }): Promise<boolean> {
    if (!["processing", "verifying", "uploading", "publishing"].includes(input.expectedStage)) return false;
    return this.transaction(async client => {
      await client.query("SELECT publication_id FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2 FOR UPDATE",
        [input.lease.tenantId, input.lease.publicationId]);
      const result = await client.query(`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE publication_operations SET poll_count=poll_count+1,updated_at=instant.at,
          next_action_at=instant.at+interval '60 seconds',
          lease_expires_at=instant.at+interval '30 seconds'
        FROM instant WHERE tenant_id=$1 AND publication_id=$2 AND lease_token=$3 AND stage=$4
          AND lease_expires_at>instant.at AND poll_count<30
          AND (next_action_at IS NULL OR next_action_at<=instant.at) RETURNING publication_id`,
      [input.lease.tenantId, input.lease.publicationId, input.lease.leaseToken, input.expectedStage]);
      return result.rowCount === 1;
    });
  }

  async checkpoint(input: Checkpoint): Promise<boolean> {
    return this.transaction(async client => {
      // Lock first, then check the DB wall clock in the CAS. A pre-lock time can go stale while waiting.
      const locked = await client.query("SELECT * FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2 FOR UPDATE", [input.lease.tenantId, input.lease.publicationId]);
      const row = locked.rows[0];
      if (!row || !allowsTransition(row.kind, input.expectedStage, input.nextStage)) return false;
      if (input.externalId !== undefined && row.external_id !== null && input.externalId !== row.external_id) return false;
      if (input.delivery && (row.kind === "facebook_reel" || input.expectedStage !== "prepared" || input.nextStage !== "creating" || row.delivery_issued_at !== null)) return false;
      const mutation = input.expectedStage !== input.nextStage && ["creating", "uploading", "publishing"].includes(input.nextStage);
      const seconds = input.nextStage === "uploading" ? 330 : 30;
      const result = await client.query(`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE publication_operations SET stage=$5, external_id=COALESCE($6,external_id),
          next_action_at=CASE WHEN $4 IN ('uploading','processing','ready','publishing','verifying')
            AND $5 IN ('uploading','processing','ready','publishing','verifying') THEN GREATEST(next_action_at,$7) ELSE $7 END,
          stage_started_at=CASE WHEN stage<>$5 THEN instant.at ELSE stage_started_at END,updated_at=instant.at,
          lease_token=CASE WHEN $8 THEN lease_token ELSE NULL END,
          lease_expires_at=CASE WHEN $8 THEN instant.at+($9 * interval '1 second') ELSE NULL END,
          delivery_issued_at=COALESCE($10,delivery_issued_at),delivery_expires_at=COALESCE($11,delivery_expires_at)
        FROM instant WHERE tenant_id=$1 AND publication_id=$2 AND lease_token=$3 AND stage=$4
          AND lease_expires_at>instant.at RETURNING publication_id`,
      [input.lease.tenantId, input.lease.publicationId, input.lease.leaseToken, input.expectedStage, input.nextStage,
        input.externalId ?? null, input.nextActionAt, mutation, seconds, input.delivery?.issuedAt ?? null, input.delivery?.expiresAt ?? null]);
      return result.rowCount === 1;
    });
  }

  async complete(input: Completion): Promise<boolean> {
    try {
      return await this.transaction(async client => {
        const locked = await client.query("SELECT * FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2 FOR UPDATE", [input.lease.tenantId, input.lease.publicationId]);
        const row = locked.rows[0];
        if (!row || TERMINAL.includes(row.stage)) return false;
        if (input.result.status === "published" && !["publishing", "verifying"].includes(row.stage)) return false;
        const stage = input.result.status === "published" ? "succeeded" : input.result.unknown ? "unknown" : "failed";
        const updated = await client.query(`WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
          UPDATE publication_operations SET stage=$4,stage_started_at=instant.at,updated_at=instant.at,
            next_action_at=NULL,lease_token=NULL,lease_expires_at=NULL
          FROM instant WHERE tenant_id=$1 AND publication_id=$2 AND lease_token=$3 AND lease_expires_at>instant.at
          RETURNING publication_id`, [input.lease.tenantId, input.lease.publicationId, input.lease.leaseToken, stage]);
        if (updated.rowCount !== 1) return false;
        const result = input.result;
        const destination = result.status === "published"
          ? await client.query(`UPDATE post_publications SET status='published',provider_post_id=$3,published_at=$4,updated_at=$4
            WHERE tenant_id=$1 AND id=$2 AND status='publishing'`, [input.lease.tenantId, input.lease.publicationId, result.providerPostId, input.now])
          : await client.query(`UPDATE post_publications SET status='failed',error_code=$3,error_message=$4,failed_at=$5,updated_at=$5
            WHERE tenant_id=$1 AND id=$2 AND status='publishing'`, [input.lease.tenantId, input.lease.publicationId,
            result.unknown ? "publication_state_unknown" : result.code, result.message, input.now]);
        if (destination.rowCount !== 1) throw new DestinationNotPublishing();
        return true;
      });
    } catch (error) { if (error instanceof DestinationNotPublishing) return false; throw error; }
  }
}
