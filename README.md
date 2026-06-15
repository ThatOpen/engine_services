# @thatopen/services

Client library and CLI for building BIM apps and cloud components on [That Open Platform](https://platform.thatopen.com). Apps run inside the platform's browser environment; cloud components run server-side and can be triggered from any app.

## Quick Start

### 1. Install the CLI

```bash
npm install -g @thatopen/services@latest
```

### 2. Choose a project type

| Type | Template | Use when |
|------|----------|----------|
| **App** | `app` | You're building a BIM app that runs in the platform's browser UI |
| **Cloud component** | `cloud-component` | You're building server-side logic triggered by an app |

### 3. Scaffold

See the full command reference here:
→ [`docs/cli/create.md`](https://raw.githubusercontent.com/ThatOpen/engine_services/main/docs/cli/create.md)

To use beta engine libraries instead of the stable ones, see:
→ [`docs/cli/swap.md`](https://raw.githubusercontent.com/ThatOpen/engine_services/main/docs/cli/swap.md)

### 4. Next steps

Once scaffolded, open `AGENTS.md` in the scaffolded project root — it has everything needed to start building.

## Beta engine libraries (Founding Members)

Founding Members get early access to the private beta engine libraries (`@thatopen-platform/*-beta`). The CLI configures access automatically — no npm account or manual token needed.

```bash
thatopen login --token <your-token>   # API token from the dashboard → Data → API Tokens
thatopen create my-app --beta         # new project on the beta libraries
# or, in an existing project:
thatopen swap --beta                  # toggle the current project to beta
```

On `--beta`, the CLI fetches your read-only beta npm credentials and writes them to the project's `.npmrc`, so `npm install` resolves the private packages. The `.npmrc` is gitignored — it carries a credential, so don't commit or share it. Access is tied to your membership; non-Founding accounts get a clear message and the project is still created.

## What's in this repository

- **Library** — `EngineServicesClient` and `PlatformClient` for interacting with the That Open API (files, folders, apps, cloud components, executions, permissions).
- **CLI** — `thatopen` command for scaffolding and publishing.
- **Built-in component types** — TypeScript stubs for platform-hosted components.

## Docs

Full reference for all CLI commands and flags:
→ [`docs/cli/paths.json`](https://raw.githubusercontent.com/ThatOpen/engine_services/main/docs/cli/paths.json)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, build commands, and publishing workflow.

