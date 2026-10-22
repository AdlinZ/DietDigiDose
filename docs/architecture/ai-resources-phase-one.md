# AI resources and business bindings — #261 phase one

This is the resource/contract/resolution and compatibility phase only. It does not complete #261: the two-page admin UI, verification/model discovery, draft/test/publish workflow, request-wide version pinning, and production acceptance remain follow-up work. Saving here takes effect on subsequent configuration reads, matching the existing settings API; it is not a publish operation. No remote model calls are made during migration or saving.

## Backend boundary

The existing authenticated admin router exposes:

- `GET /api/v1/admin/ai-config/resources`: schema/revision, redacted resources, stable service catalog, effective configuration and binding source. Before migration it returns a virtual legacy document without writing.
- `POST /api/v1/admin/ai-config/resources/migrate`: atomic, idempotent creation of the legacy-reference document. It never replaces an existing resource document.
- `PUT /api/v1/admin/ai-config/resources`: full document replacement with the current `revision`. Stale updates fail. Send only `schemaVersion`, `revision`, `resources`, `defaults`, and `services`; GET-only metadata and effective results are not writable.

`resources.ts` defines the runtime-validated input/storage contracts. Resource IDs are unique. The implemented protocol is `openai-compatible`, supporting chat, vision and ASR models through the existing adapters. Catalog declarations do not prove remote availability; new connections are explicitly `unverified`. Unknown protocols, unknown services, missing resources and incompatible model/capability bindings fail validation. Search/tools and TTS are not offered as new service bindings because this phase does not add adapters.

Defaults are keyed by `chat`, `vision`, `asr`, with targets such as `{ "resourceId": "first", "model": "chat-model" }`. Every service has either a target or `{ "inherit": true }`. Chat/vision/ASR inherit their capability default. Supervisor/nutrition/recipe/operations inherit the effective chat service and retain any legacy role model override. For a newly declared connection, inherited role overrides must appear in its chat-capable model catalog; otherwise bind the role explicitly or intentionally clear the old override.

A connection contains `id`, `name`, `kind: "connection"`, `protocol: "openai-compatible"`, `baseUrl`, and `models: [{ id, capabilities }]`. Endpoints cannot include URL credentials, query strings or fragments. A credential input is one of:

- Omitted or `{ "action": "keep" }`: preserve the current secret for this resource ID. New connections start without a secret. An empty UI field must map to keep/omission.
- `{ "action": "replace", "value": "…" }`: replace with a nonempty secret; blank replacement is rejected.
- `{ "action": "clear" }`: explicitly remove it. New connection clearing does not fall back to environment/global secrets.

GET never returns `apiKey`; it returns `hasApiKey` and a fixed mask. Secrets stay in the existing server-side settings store and must receive the same database/access/backup protection as legacy AI keys. No plaintext credentials belong in client configuration, logs or audit details. There is no new encryption/key-management claim in this phase.

## Compatibility and storage

A schema-v1 document lives in `system_settings.AI_RESOURCE_CONFIG_V1`. Both database adapters use atomic conditional writes in transactions, including conflict-safe insertion for migration. There is no new SQL table/schema migration. Legacy `legacy-chat`, `legacy-vision`, and `legacy-asr` resources reference the old resolver instead of copying resolved credentials or environment defaults; subsequent old UI edits and environment changes therefore retain their original field-level precedence. All four old role models remain active when inherited. Global top-level fields stay backward compatible, including the existing TTS fallback; ASR/local-voice selection and runtime budgets/policy are unchanged.

Migration preserves all original keys and is safe to retry. Failed writes roll back; no process-local config cache needs invalidation. Reopening storage resolves the same document. To revert bindings, submit a current-revision document with the legacy defaults and inherited services; this leaves the old values available without deleting other settings. Concurrent saves use compare-and-swap against the previous raw document and reject stale revisions.

Validation covered: two connections, independent/ inherited bindings, model incompatibility, credential operations/redaction, legacy/env/role precedence, budget preservation, stale updates, real SQLite file reopen and trigger-induced rollback, and PostgreSQL adapter transaction statements with a mock client. PostgreSQL live-database behavior and real provider/device calls have not been verified by these tests.
