# #261 — resource and service admin UI slice

Baseline: `15b0102390ea65970ef54629638042219ae1930f`. This slice does not complete #261 and does not deploy or change production configuration.

## Pages and compatibility

- `/admin/ai-providers`: legacy references and editable OpenAI-compatible connections; endpoint, manual model/capability catalog, credential keep/replace/clear. Stable connection IDs are generated locally. Persisted secrets and masks never populate inputs; replacement uses a password field. Clear requires explicit confirmation.
- `/admin/ai-services`: capability defaults and the seven implemented v1 catalog services; capability-filtered resource/model selection, inheritance versus override, and server-returned effective model/endpoint/source. Effective values are explicitly the last read snapshot, not a prediction of unsaved changes. Inherited role model overrides remain server-owned.
- `/admin/ai-config`: original compatible settings, persona and runtime budgets remain reachable under “旧配置与策略”; voice packs remain reachable. No backend, client, runtime, TTS, voice policy or public contract changes.
- Saving immediately affects subsequent configuration reads. There is no draft/publish, test, discovery or availability claim. Connection success cannot prove vision/ASR capability. No arbitrary service creation or workflow editor.

## Write and lifecycle boundary

`admin/src/services/aiResources.ts` explicitly projects the five writable document fields. GET metadata, masks, effective results, and any unexpected raw `apiKey` are excluded. A full-document save preserves the other page's bindings/resources and all v1 inherited targets. Client validation covers IDs, name/model/secret length, URL credentials/query/fragment, duplicate models, capabilities and references; the server remains authoritative for role and runtime-policy compatibility.

Saving uses a synchronous duplicate guard, preflight revision read and backend CAS. A changed revision stops the write. Any failed/uncertain write disables retry until a deliberate reread; errors never render server response bodies or credential values. The preflight is a UX check, not a replacement for backend atomic concurrency control. Pending saves cannot be canceled or navigated away from inside the app. Before saving, cancellation discards only local changes. Reads are abortable and stale completions are ignored; save ownership ends on unmount. Browser unload warns without pretending a dispatched PUT can be rolled back.

The root now uses React Router's browser data router with the existing App routes unchanged, enabling `useBlocker` for internal links and history navigation. Existing guards still protect the admin subtree.

## Integration needs / backend limitations

1. The existing resources PUT returns the same generic HTTP 400 for revision conflicts, validation, policy rejection and storage errors. UI intentionally does not infer a particular cause from that response. A future compatible extension should expose a stable conflict code / HTTP 409, validation codes and safe field paths. No backend change was made here.
2. New-connection test/model discovery and capability-specific verification are not supplied by v1. Do not call the legacy test endpoint with omitted resource credentials: its global fallback is not resource-aware. Future operations should accept resource identity / explicit credential intent and return separate chat/vision/ASR verification evidence.
3. Search integration must extend the service catalog, resource/tool discrimination, read/write mapper and selection controls intentionally. Current UI types and allowlist are v1-specific and cannot safely round-trip an expanded contract. Tool-only search must not be forced to have a model. Integrate before exposing new schema fields/services to this UI.
4. The legacy configuration GET includes resolved effective values; it is not an API for reading raw legacy settings independently of active resource bindings. This slice preserves that existing page/behavior. A future legacy-settings editor should receive raw editable values and field provenance separately to avoid copying effective new-resource values into old fields when saving unrelated legacy settings.
5. Draft/test/publish, request-version pinning, real provider availability and physical-device behavior remain later acceptance work.

## Local verification

Tools used here: Node 25.2.1 (the installed host version), existing lockfile dependencies, no dependency additions. The repository pins Node 22.23.2; verification under that exact version remains for integration/CI. Node 25 exposes experimental global localStorage incompatible with one existing test, so disable that experiment for the suite:

```sh
cd admin
NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/vitest run
./node_modules/.bin/tsc -b
./node_modules/.bin/oxlint
./node_modules/.bin/vite build
```

The 21 new tests cover writable projection/redaction, validation, all credential actions, cancellation, same-tick duplicate submission, generic backend rejection, preflight conflict, stale success/failure/read handling, independent capability-filtered connections, unsaved navigation, pending-save ownership, beforeunload and unmount during preflight. The complete admin suite passed 115 tests across 18 files; TypeScript, oxlint (no warnings) and the Vite production build passed. Existing admin tests are included in the suite. This is mock-backed UI verification, not a live database/provider integration test.

For reproducible visual review, run `node scripts/preview-ai-resources.mjs` from `admin`. This binds only `127.0.0.1:5186`, injects a clearly fake demo token, intercepts all `/api/` traffic, rejects writes, and uses `.invalid` endpoints with no secrets. Open `/admin/ai-providers` and `/admin/ai-services`. Never use this demonstration harness as a production server.

Screenshot evidence is outside the Git worktree at `/Users/adlin/Documents/Codex/2026-10-23/task/evidence-261/`: `providers-top.png`, `providers-detail.png`, `services-top.png`, `services-detail.png`, `providers-mobile-top.png`, `providers-mobile-detail.png`. Desktop viewport 1440×1200; mobile viewport 390×844. All three inspected views loaded, no document horizontal overflow, no browser exceptions. Screenshots contain demonstration data only.

### Read-only inspection of the search branch

Reviewed `codex/deepseek-tools` commit `65f86fe0e87a42a95794f390bc2732b04858819c` and its `docs/architecture/deepseek-tools.md`; no merge or edits to that worktree. Its additive schema-v1 tool resources use `kind: tool`, `protocol: deepseek-tools`, `tools`, optional `defaults.search/fetch`, and `services.search/fetch` targets/inherit/disabled, plus extended catalog/effective data. Search has an isolated adapter but no Agent automatic invocation or execution route; Fetch is always disabled. `toolConfig()` is server-only and credential-bearing, never a UI endpoint.

Until independent integration, this UI rejects an extended configuration at read, preflight and serialization boundaries with an explicit unsupported-configuration message. It does not display Search/Fetch as usable or drop their fields in PUT. Even an extended catalog with disabled/omitted tool bindings is blocked. Integration must add a discriminated model/tool editor and preserve the optional tool fields; it must not just relax this guard. Five regression tests cover tool resources, disabled search bindings, extended catalog, a backend extension between initial load and save, and an unsupported save response.
