---
'thatopen-services': minor
---

Align the client with the platform's new project-scoped permissions model and split the client surface for apps vs components.

**New: `PlatformClient`.** Extends `EngineServicesClient` with a bearer-only constructor — the full method surface is inherited, the difference is auth. Use it from apps, frontends, and any caller authenticating with a user JWT. `EngineServicesClient` remains the right choice for components (API-token auth, local server, WebSocket progress).

**Project-scoped listings on the main list methods.** `listFiles`, `listFolders`, `listApps`, and `listComponents` now accept an optional `projectId` and forward it to the new public `GET /item?projectId=X` / `GET /item/folder?projectId=X` routes. Per-entity role overrides are applied server-side; callers without project role permission get 403 (not an empty list). Pass `itemType: 'APP' | 'TOOL' | 'FILE'` to switch what comes back.

**Updated permission checks.** `checkPermission` now returns `{ hasPermission, scope }` where `scope` is `'global' | 'project' | 'entity' | 'none'`. New `checkPermissionBatch(checks)` evaluates multiple checks in one round-trip.

**Execution scoping.** `executeComponent` accepts `projectId` as a reserved key on `executionParams`; foreign project ids are rejected by the backend. `listExecutions(componentId, projectId?)` forwards the query param.

**Breaking.** The v1 convenience helpers `listProjectFiles`, `listProjectFolders`, `listProjectApps`, `listProjectComponents` are removed. They pointed at JWT-only `/project/:id/*` routes, which was the wrong target for an API-token client. Replace with `listFiles({ projectId })` / `listFolders({ projectId })` / `listApps({ projectId })` / `listComponents({ projectId })`.
