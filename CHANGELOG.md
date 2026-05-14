# thatopen-services

## 0.18.0

### Minor Changes

- b598e3c: Surface structured API errors via a new RequestError class

## 0.17.0

### Minor Changes

- e4fbb63: Per-version free-JSON metadata for files. Replaces the old single-endpoint `getFileMetadata` with three explicit version-scoped methods aligned with the new backend CRUD on `/item/:id/version/:tag/metadata`.

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

## 0.16.0

### Minor Changes

- 9f124f1: Add per-version lifecycle methods so callers can list, archive, recover, and permanently delete a single version of an item.
  - `listVersions(itemId, { archived })` — `GET /item/:itemId/versions`. Pass `archived: true` to receive only archived versions, `false` for active only, or omit the option to receive both. Sorted by creation date descending.
  - `archiveVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/archive`. Archived versions are hidden from the active list and queued for cleanup after the platform's retention window.
  - `recoverVersion(itemId, versionTag)` — `PUT /item/:itemId/version/:versionTag/recover`. Returns an archived version to the active list.
  - `deleteVersion(itemId, versionTag)` — `DELETE /item/:itemId/version/:versionTag`. The version must be archived first; the backend rejects the call otherwise. Removes the underlying object from S3 in addition to the database row.

  All four go through the existing request layer, so they work with both auth modes (`accessToken` query string for API tokens, `Authorization: Bearer …` for `PlatformClient` JWTs).

## 0.15.0

### Minor Changes

- 3a0b129: Send named File (with filename and mimetype) for bundle and icon uploads in the publish command.

## 0.14.0

### Minor Changes

- b108648: Align the client with the platform's new project-scoped permissions model and split the client surface for apps vs components.

  **New: `PlatformClient`.** Extends `EngineServicesClient` with a bearer-only constructor. Use it from apps, frontends, and any caller authenticating with a user JWT. On top of the inherited API-token-compatible surface, `PlatformClient` owns the JWT-only routes `getProject`, `getProjectData`, `checkPermission`, and `checkPermissionBatch` — those hit `ProjectController` on the backend which is guarded by JWT, so they're not reachable from an access token. `EngineServicesClient` remains the right choice for components (API-token auth, local server, WebSocket progress).

  The `PlatformClient` constructor accepts either a static JWT string **or a provider function** (`() => string | Promise<string>`) that's called on every request — so Auth0's `getAccessTokenSilently()` and similar refreshing sources can be passed directly and expired tokens never stick. `PlatformClient.fromPlatformContext()` is available as a static factory for apps running inside the platform iframe.

  **Project-scoped listings on the main list methods.** `listFiles`, `listFolders`, `listApps`, and `listComponents` now accept an optional `projectId` and forward it to the new public `GET /item?projectId=X` / `GET /item/folder?projectId=X` routes. Per-entity role overrides are applied server-side; callers without project role permission get 403 (not an empty list). Pass `itemType: 'APP' | 'TOOL' | 'FILE'` to switch what comes back.

  **Updated permission checks.** `checkPermission` now returns `{ hasPermission, scope }` where `scope` is `'global' | 'project' | 'entity' | 'none'`. New `checkPermissionBatch(checks)` evaluates multiple checks in one round-trip.

  **Execution scoping.** `executeComponent` accepts `projectId` as a reserved key on `executionParams`; foreign project ids are rejected by the backend. `listExecutions(componentId, projectId?)` forwards the query param.

  **Breaking.** The v1 convenience helpers `listProjectFiles`, `listProjectFolders`, `listProjectApps`, `listProjectComponents` are removed. They pointed at JWT-only `/project/:id/*` routes, which was the wrong target for an API-token client. Replace with `listFiles({ projectId })` / `listFolders({ projectId })` / `listApps({ projectId })` / `listComponents({ projectId })`.

### Patch Changes

- d92f4e9: update @thatopen dependencies to version 3.4.0 across templates

## 0.13.1

### Patch Changes

- 09341b5: fix: update default login API URL

## 0.13.0

### Minor Changes

- 7ce2d0f: templates refactor to align them with SKILL patterns

## 0.12.0

### Patch Changes

- 28cd180: Updates templates to use new app setup logic

## 0.11.1

### Patch Changes

- 626d202: better type handling for built-in components

## 0.11.0

### Minor Changes

- rebuild built-in types

## 0.10.0

### Minor Changes

- c6516d0: Deploy new version

## 0.9.0

### Minor Changes

- Rename `client.initApp()` to `client.setup()` for a cleaner API surface

## 0.8.0

### Minor Changes

- b7949c0: Add icon support for items (apps, components, files).

  **Library:** New `uploadItemIcon`, `getItemIcon`, and `removeItemIcon` methods on `EngineServicesClient` for managing item icons via the `PUT/GET/DELETE /api/item/:id/icon` endpoints. Accepts PNG, WebP, and ICO images up to 512 KB.

  **CLI:** `thatopen publish --icon <path>` uploads an icon after publishing. The icon path is saved to `.thatopen` config so subsequent publishes reuse it automatically.

## 0.7.0

### Minor Changes

- 5e75861: Adds dev improvements

## 0.6.1

### Patch Changes

- Improve naming

## 0.6.0

### Minor Changes

- Adding parameters related to metadata in items

## 0.5.7

### Patch Changes

- Allow for parentId when creating folders

## 0.5.6

### Patch Changes

- Allow for fetching with versions for components

## 0.5.5

### Patch Changes

- Improve hidden items

## 0.5.4

### Patch Changes

- Add hidden files

## 0.5.3

### Patch Changes

- fix error result

## 0.5.2

### Patch Changes

- Remove axios | add retries

## 0.5.1

### Patch Changes

- Fix execution callback

## 0.5.0

### Minor Changes

- File download improvements

## 0.4.11

### Patch Changes

- Fix socket connect

## 0.4.10

### Patch Changes

- fix execute not sending params

## 0.4.9

### Patch Changes

- Add abortExecution

## 0.4.8

### Patch Changes

- Add standard downloadComponent function

## 0.4.7

### Patch Changes

- Return bundle from downloadComponentBundle

## 0.4.6

### Patch Changes

- Fix get file

## 0.4.5

### Patch Changes

- improve types

## 0.4.4

### Patch Changes

- Add show versions parameter to item fetch

## 0.4.3

### Patch Changes

- Remove socket return from progress

## 0.4.2

### Patch Changes

- Improve returning types

## 0.4.1

### Patch Changes

- fix typings

## 0.4.0

### Minor Changes

- Adding execution function and listeners

## 0.3.2

### Patch Changes

- Change types in component creation

## 0.3.1

### Patch Changes

- Allow creation of drafts

## 0.3.0

### Minor Changes

- Add execution params

## 0.2.9

### Patch Changes

- Move extraProps to version data

## 0.2.8

### Patch Changes

- Fix folders not being sent

## 0.2.7

### Patch Changes

- Fix accept method in result

## 0.2.6

### Patch Changes

- Fix fetch content type

## 0.2.5

### Patch Changes

- Cleanup query object in main function

## 0.2.4

### Patch Changes

- Fix optional fields in list functions

## 0.2.3

### Patch Changes

- return proper error message

## 0.2.2

### Patch Changes

- Add more verbosity to error

## 0.2.1

### Patch Changes

- Fix issue with empty json responses

## 0.2.0

### Minor Changes

- Replace axios with fetch for a better dev experience

## 0.1.10

### Patch Changes

- Add generics and responseType to file downloads

## 0.1.9

### Patch Changes

- Change return type of downloads to ReadableStream

## 0.1.8

### Patch Changes

- remove type module

## 0.1.7

### Patch Changes

- remove gaxios due to a bug in the browser

## 0.1.6

### Patch Changes

- Added Stream return type to downloads

## 0.1.5

### Patch Changes

- - Improved build
  - Fixed minor bugs
  - Improved lint for dev experience

## 0.1.4

### Patch Changes

- - File and folder download functions

## 0.1.3

### Patch Changes

- add build
- fix build not working

## 0.1.1

### Patch Changes

- Allow for creation and update of components

## 0.1.0

### Minor Changes

- Fix issues with folders and files | add recovering
