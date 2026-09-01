# Kitchenware concept layer v4

Issue [#66](https://github.com/AdlinZ/DietDigiDose/issues/66) publishes the source archive
`kitchenware-concept-layer-v4-6648.zip`. The application integrates its canonical concept and alias layers through
`server/src/data/kitchenwareCatalogV4.generated.ts`.

## Provenance

- Release: `kitchenware-concept-layer-v4-20260901`
- Source archive SHA-256: `787e5984db145f111ef04d346bca27ff5b61faf41718028bc74697c69e1a600a`
- Canonical concept JSONL SHA-256: `a8526d290364d70cee89d767d6f37b95da1778c266655e55036b26912f657d40`
- Alias JSONL SHA-256: `a0cea097723b0e2a93dfdc86221083d73f8039455d0238c21f8736eb230c9ff4`
- Runtime catalog: 241 type concepts and 271 non-canonical aliases

The generated runtime catalog excludes the root and eight grouping concepts because users select concrete kitchenware
types. Source categories and hierarchy identifiers remain in `attributes_json`; application categories are mapped onto
the existing five-category client contract.

The archive's 6,648 product records are not bundled into the application. Every source record is marked
`license_status=review_required`, so product titles, descriptions, images, and URLs remain outside the distributable
runtime until their licenses are cleared. The archive remains the audit source for 6,648 product links and 402 unresolved
records.

## Regeneration

Extract the verified source archive outside the repository, then run:

```bash
pnpm --dir server run data:kitchenware:generate -- /absolute/path/to/extracted-v4
```

The generator rejects unexpected concept or alias checksums and row counts. Do not hand-edit the generated TypeScript.

SQLite seeds the catalog after schema migrations. PostgreSQL seeds it transactionally after schema validation, guarded
by a database advisory lock so API and worker startup are safe to run concurrently. Existing administrator-created rows
are preserved; only known legacy system seeds are upgraded to v4 metadata and aliases.
