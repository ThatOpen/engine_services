---
'thatopen-services': minor
---

Add per-version lifecycle methods so callers can list, archive, recover, and permanently delete a single version of an item.

- `listVersions(itemId, { archived })` — `GET /item/:itemId/versions`. Pass `archived: true` to receive only archived versions, `false` for active only, or omit the option to receive both. Sorted by creation date descending.
- `archiveVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/archive`. Archived versions are hidden from the active list and queued for cleanup after the platform's retention window.
- `recoverVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/recover`. Returns an archived version to the active list.
- `deleteVersion(itemId, versionTag)` — `DELETE /item/:itemId/version/:versionTag`. The version must be archived first; the backend rejects the call otherwise. Removes the underlying object from S3 in addition to the database row.

All four go through the existing request layer, so they work with both auth modes (`accessToken` query string for API tokens, `Authorization: Bearer …` for `PlatformClient` JWTs).
