---
'thatopen-services': minor
---

Per-version free-JSON metadata for files. Replaces the old single-endpoint `getFileMetadata` with three explicit version-scoped methods aligned with the new backend CRUD on `/item/:id/version/:tag/metadata`.

**New methods.**

- `getFileVersionMetadata(fileId, versionTag, params?)` — `GET /item/:id/version/:tag/metadata`. Returns `{}` when the version exists but has no metadata.
- `updateFileVersionMetadata(fileId, versionTag, metadata)` — `PUT …/metadata`. Replaces the version's metadata with the provided object.
- `deleteFileVersionMetadata(fileId, versionTag)` — `DELETE …/metadata`. Clears the version's metadata.

**New types and constants.** `Metadata = Record<string, MetadataValue>`, `MetadataValue = string | number | boolean | null`, and `METADATA_LIMITS` (200 fields, 50-char keys, 50-char values) are exported from the package root. `metadata` is now typed as `Metadata` everywhere it appears: `CreateItemProps`, `UpdateItemProps`, `createVersion`'s optional last argument.

**Breaking.** `getFileMetadata(itemId, params?)` is removed. It hit `GET /item/:id/metadata`, which has been deleted on the backend in favour of the version-scoped routes. Replace with `getFileVersionMetadata(fileId, versionTag, params?)` — the version tag is now required because metadata is per-version. To target the live version, pass the tag of the latest non-draft version (the equivalent of the old default behaviour).

**Migration.**

```ts
// before
const metadata = await client.getFileMetadata(fileId);

// after
const metadata = await client.getFileVersionMetadata(fileId, 'v1');
```

`createFile`, `updateFile`, and `createVersion` continue to accept an optional `metadata` argument; the only change is the type — values can now be `string | number | boolean | null` instead of just `string`.
