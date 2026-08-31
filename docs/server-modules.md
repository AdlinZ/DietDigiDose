# Server domain module template

The server remains a modular monolith. Inventory is the reference module under `server/src/modules/inventory` and keeps the existing public API paths.

## Dependency direction

```text
app composition root
  └─ route → service → InventoryRepository interface
                         └─ SQLite or PostgreSQL adapter
```

- `route.ts` owns authentication middleware, parameter adaptation, status codes, and HTTP error mapping. It contains no SQL and does not choose a database implementation.
- `schema.ts` re-exports the shared API boundary schemas from `@dietdigidose/contracts`.
- `service.ts` owns business rules, orchestration, idempotent side-effect decisions, and domain errors. It receives an `InventoryRepository`, so unit tests use an in-memory replacement.
- `repository.ts` is an async, driver-neutral persistence port. It never exposes a database connection, query builder, transaction object, or driver row.
- `sqliteRepository.ts` owns SQL, row normalization, optimistic writes, and atomic transactions for the current runtime.
- `index.ts` is the only module composition root. A PostgreSQL cutover replaces the adapter here without changing routes or services.

Every module keeps the five-file core (`route.ts`, `schema.ts`, `service.ts`, `repository.ts`, and `types.ts`). Driver adapters such as `sqliteRepository.ts` or `postgresRepository.ts` sit beside that core, and `index.ts` wires the selected adapter.

Atomic multi-write operations must be a single repository method. The service decides when that atomic operation is required; the adapter implements it with its native transaction API. Repository results use domain or shared-contract types, not SQLite/Drizzle records.

## Migrating another domain

1. Inventory the route's handlers, SQL, cross-domain calls, transaction scopes, idempotency keys, and error codes.
2. Move shared request/response schemas to `packages/contracts` before moving the handler.
3. Define the smallest async repository interface that supports both the current adapter and a future PostgreSQL adapter.
4. Move business decisions into a service. Keep response status and request parsing in the route.
5. Move SQL and row conversion into the current adapter; preserve transaction and concurrency behavior.
6. Wire dependencies in `index.ts`, update `app.ts`, and remove the legacy route.
7. Add service tests with a fake repository plus API-level compatibility tests.
8. Add the domain to `scripts/check-module-boundaries.mjs` and run `pnpm -w architecture:check`.

Do not create a microservice, import another domain's concrete repository, or let Drizzle/SQLite types cross the repository port. Cross-domain behavior should use a narrow service port or an injected callback until a shared application service is justified.
