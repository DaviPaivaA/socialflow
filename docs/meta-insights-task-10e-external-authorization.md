# Task 10E — offline approval and synthetic manual flow

This is code preparation, not an operational authorization system. A successful run reports `READY_FOR_AUTHORIZATION` with `realExecutionAuthorized: false`; that state means only that the synthetic code path is ready to be reviewed. It does **not** mean human authorization, Meta consent, actual permissions, asset ownership, or successful Meta access. No `EXECUTION AUTHORIZED` result exists. Real execution remains blocked before credential input. No environment flag, terminal acknowledgement or test key can enable it.

## Boundaries and interfaces

Three new experimental modules are not wired to the application or a CLI:

- `metaInsightsExternalAuthorization.ts`: strict, copied/frozen canonical claims; SHA256; public-key-only Ed25519 verification. No key generation, signing or private-key loading.
- `metaInsightsDurableAdmission.ts`: exclusive, synchronous, durable metadata receipt before any input or execution await.
- `metaInsightsAuthorizedManualFlow.ts`: explicit synthetic trust + context + private receipt directory, synthetic-only protected input from 10D, and prepared synthetic executor from 10C. No default terminal, credential provider or network implementation.

The module reads the HTTPS builtin identity only to deny it before input. It never invokes that builtin. Transport injection is a **trusted dependency boundary, not a sandbox**: arbitrary supplied JavaScript, wrappers around a native/network function, a malicious terminal, bootstrap code or a compromised operator can bypass process-local intentions. The caller must supply a genuinely synthetic transport and terminal. Tests use fake streams and local temporary directories; none perform Meta requests.

`createSyntheticAuthorizedManualFlow` accepts explicit synthetic public trust entries, `receiptDirectory`, `currentContext`, and an optional clock. A run requires `mode: "simulation"`, a test terminal, a fake `testRequest`, canonical claims and an independent synthetic signature. No option creates real trust. Non-synthetic modes and the direct native binding are rejected before input. A missing terminal fails closed; no stdin/stdout fallback exists. The optional simulation timeout can only shorten the signed 10-second cap.

## Canonical signed protocol

Claims are a plain data record with exactly these fields, in canonical serialization order:

`domain`, `environment`, `runId`, `operatorAlias`, `requestedByAlias`, `tenantId`, `operation`, `purpose`, `approvedCodeSha256`, `issuedAt`, `expiresAt`, `limits`.

The request domain is `socialflow.meta-insights.synthetic.authorization.v1`; the environment must be `synthetic`. Both run and tenant identifiers are canonical lowercase UUIDs. Workspace is the tenant in SocialFlow: there is no invented second workspace authority. Operator/requester aliases are distinct, bounded identifiers; they are not physical identity proofs. The provisioned public key must be public Ed25519 material, have a unique bounded key ID and be associated with the expected operator. The caller's trust objects are copied at bootstrap. The envelope cannot contain or choose a new trusted key.

The exact operation is a single decimal Page ID, `v26.0`, `page_media_view`, `day`, and integral UTC-midnight Unix-second `since`/`until`. The existing 10A window validation remains in use: ordered, historical, at most 90 days and within its lookback. Purpose is `validate_facebook_page_insights_batch_read`. The code reference is lowercase SHA256; validity is at most five minutes and is checked at admission and after waits. Unknown fields, symbols, accessors, custom prototypes, missing fields and malformed values are rejected. Host, path, HTTP method overrides and arbitrary URLs cannot enter the claims.

Exact limits are one external request, zero retries/redirects/pagination, `automaticMonetarySpend: false`, 10,000ms, 32,768 request bytes and 1,048,576 response bytes. The inner Batch operation is GET; the existing fixed Graph Batch wrapper is POST to `https://graph.facebook.com/v26.0/`. No response continuation is followed.

`JSON.stringify` of the validated canonical snapshot is hashed with SHA256. Ed25519 signs UTF-8 bytes of `socialflow.meta-insights.synthetic.approval.v1`, a newline, and that lowercase hash. An envelope has exactly `domain`, `keyId`, `requestSha256`, and a canonical base64 64-byte signature. The signature therefore binds every claim, including run, operator/requester, tenant, Page, metric, period, window, purpose, code, environment, validity and limits. The verifier is an offline cryptographic primitive; the orchestration is responsible for current validity/context. Its result never grants real execution capability.

## Durable single use

The caller must explicitly provision an absolute, normalized directory on a trusted local filesystem, owned by the current UID with no group/other permissions. The module does not create directories, inspect user files, or persist credentials. Symlink components, symlink/nonregular receipts, foreign ownership, insecure permissions and unavailable persistence fail closed.

Before the first input/credential/execution await, synchronous `O_CREAT | O_EXCL | O_NOFOLLOW` creation (the `wx` exclusivity contract) reserves `<runId>.json` at mode 0600. Contents are only schema, run UUID and request SHA256. The file and directory are fsynced before admission succeeds. Device/inode identities and permissions are checked; a preexisting run is blocked even if a reconstructed request uses another hash. Independent processes sharing the same directory compete on the filesystem, not a process-local map.

Receipts are **never removed**, including on abort, timeout, input failure, driver failure, context expiry or uncertain persistence. Failure to establish durability blocks execution and does not intentionally reopen the run. Losing/removing/cloning/rolling back the directory can lose replay history; this is not an antirollback service, distributed lock, network-filesystem guarantee, root defense or defense against another malicious process with the same UID. File checks do not eliminate all path races against a compromised local principal. The directory and its ancestry must remain under trusted operational control. A restart must use the same preserved receipt directory; choosing a fresh directory is not a legitimate retry.

## Revalidation, results and external blockers

The signed request and limits are copied and frozen. Changes to the caller's original input cannot change the admitted operation. The trusted current-context callback must still match tenant, operator/requester, environment and approved code hash. Validity/context are checked after input waits, after asynchronous multipart encoding immediately before dispatch, and after execution. Abort/expiry cannot return readiness or renew the reserved budget. Synthetic credentials do not appear in results or receipts; JavaScript cannot guarantee memory zeroization.

Reports contain only sanitized states/outcomes, synthetic dispatch count and prerequisite IDs with `not_verified`. No credential, proof, signature, body, response payload or dependency exception is returned. `read_insights`, `pages_read_engagement`, `pages_show_list`, Page token kind, `ANALYZE`, eligibility, app access and Batch compatibility remain separate and unverified; a requested scope is not a granted scope.

Future **real** trust bootstrap is intentionally absent. An operator would need an independently authenticated public key provisioned through a trusted channel outside the envelope/repository/Codex, a private key kept offline and inaccessible to the executor, a separate real domain/environment and a reviewed real admission/binding implementation. The approved code digest and runtime context would need an independently trusted source rather than self-reported values. Substituting the bootstrap public key, context provider, code hash, receipts or execution code can forge the whole trust story. Distinct aliases alone cannot prove independent people. No real key is configured here, and these missing prerequisites must not be inferred from valid test signatures or code readiness.

## Verification

Run focused tests with Node directly, without `.env` loading:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.server.config.ts server/test/metaInsightsExternalAuthorization.test.ts --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tsconfig.experiments-10e.json --noEmit
```

The concurrency test launches independent Node processes with a minimal PATH-only environment; this environment's sandbox blocks nested execution with EPERM despite misleading empty stdout/exit status, so the verified multiprocess run requires explicit local execution approval. No network permission is used by the tests. The initial stubs and the native-binding identity regression each have recorded functional RED→GREEN evidence in the task ledger.

## Referências oficiais verificadas nesta sessão

Node22.23.3: [crypto.verify/Ed25519](https://nodejs.org/download/release/v22.23.3/docs/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback) e [flags de filesystem](https://nodejs.org/download/release/v22.23.3/docs/api/fs.html#file-system-flags), consulta pública23/10/2026. A verificaçãoEd25519 usa algoritmo null; criação exclusiva e sincronização são contratos locais, não comprovação de transporteMeta ou proteção antirrollback. Nenhuma API Meta autenticada foi consultada.
