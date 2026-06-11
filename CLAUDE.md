# engine_services — Agent Guide

## Repo structure

Three distinct outputs from one repo:

- **Library** (`src/core/`, `src/built-in/`, `src/types/`) — `@thatopen/services` npm package
- **CLI** (`src/cli/`) — `thatopen` binary, built separately via `vite.config.cli.mts`
- **Templates** (`src/cli/templates/`) — scaffold output; excluded from the root `tsconfig.json`, each template has its own

## Critical: auto-generated files

**Never edit `src/built-in/index.ts` by hand.** It is fully overwritten by `platform_builtin-components/scripts/distribute-types.mjs` on every build of that sibling repo. Changes will be lost. The builtin repo isn't public.

## Build

```bash
npm run build        # full build: lint + tsc + library + CLI
npm run build:lib    # library only
npm run build:cli    # CLI only
```

## Keep this file current

**Any change to this repo that affects what's written here requires updating this file.** This file must never go stale.

## Client changes → update examples

**After any change to `src/core/client.ts` or `src/core/platform-client.ts`**:

1. Run the affected example(s) in `src/core/examples/` to verify nothing broke.
2. Update the example to reflect the change — add coverage for new methods, remove calls to deleted/renamed ones, and adjust comments if the behavior changed.

Examples live one-per-domain: `files.ts`, `folders.ts`, `file-metadata.ts`, `components.ts`, `apps.ts`, `execution.ts`, `hidden-files.ts`, `icons.ts`, `permissions.ts`. Add a new file when a new domain is introduced.

`docs/client/paths.json` is auto-generated — never edit it by hand. Run `node scripts/generate-client-examples-paths.mjs` (or `npm run build`) to regenerate it after adding or renaming an example.

## Writing examples

Add a comment only when the behavior would surprise a reader who knows the method name — backend constraints, non-obvious defaults, or side effects that aren't visible in the call. Don't comment what the method name already says.

Examples of comment-worthy behavior:
- `downloadFile` without `versionTag` always returns the **latest** version, not the one from `createFile`.
- `archiveFile` is a soft-delete — it's reversible via `recoverFile`.

## CLI changes → update docs

**After any change to `src/cli/commands/` or `src/cli/templates/`**, update the corresponding doc in `docs/cli/`.

- One file per command: `docs/cli/create.md`, `docs/cli/serve.md`, `docs/cli/login.md`, `docs/cli/publish.md`, `docs/cli/run.md`, `docs/cli/local-server.md`, `docs/cli/swap.md`.
- `docs/cli/paths.json` is auto-generated — never edit it by hand. Run `node scripts/generate-cli-docs-paths.mjs` (or `npm run build`) to regenerate it after editing any MD.

## Two client classes — don't conflate them

| | `EngineServicesClient` | `PlatformClient` |
|---|---|---|
| Auth | API token (query param) | User JWT (Bearer header) |
| For | Cloud components | Apps / frontends |
| Extra routes | — | `getProject`, `checkPermission`, `checkPermissionBatch` |

`PlatformClient` extends `EngineServicesClient`. Both expose `fromPlatformContext()`.

## Template authoring

- Truly shared files (`.gitignore`, `AGENTS.md`, `CLAUDE.md`) live in `src/cli/templates/shared/` and are copied first. `AGENTS.md` there is a stub that points scaffolded projects to `node_modules/@thatopen/services/resources/AGENTS.md`.
- All other template files (`tsconfig.json`, `vite.config.js`, `index.html`, `src/`, etc.) live directly in their template folder (`app/` or `cloud-component/`) and are copied via `cpSync`.
- The full agent router for scaffolded projects lives in `resources/AGENTS.md` and ships with the npm package — it is **not** the guide for working on this repo (that's `CLAUDE.md`).
- Available templates: `app` and `cloud-component`. The `TEMPLATES` constant in `src/cli/commands/create.ts` is the single source of truth.
- Beta mode is tracked in `.thatopen` (`beta: true`). The beta ↔ stable package mapping lives in `src/cli/lib/beta.ts` — update it there only.
- Placeholder `{{PROJECT_NAME}}` and `{{VERSION}}` in `package.json` are replaced at scaffold time.

## Config resolution

Local `.thatopen` (project root) takes priority over global `~/.thatopen/config.json`. The `resolveConfig()` helper in `src/cli/lib/config.ts` handles this — use it, don't re-implement.

## Backend permissions contract

When a request includes a `projectId`, the backend validates that the resource belongs to that project and the caller has permission there — regardless of access in other projects. This enforcement is server-side and invisible in the client code.

`checkPermission` returns `{ hasPermission, scope }` where `scope` is `'global' | 'project' | 'entity' | 'none'`:
- `global` — admin/owner bypass
- `project` — role-level grant on the project
- `entity` — per-entity override
- `none` — denied

`checkPermissionBatch` evaluates multiple checks in one round-trip. Per-entity overrides (`removePermission`, `appliesToDescendants`) are applied server-side when listing files/folders — no client change needed.
