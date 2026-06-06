# Scaffolding a New App

When starting a new platform app from scratch, **always use the CLI to scaffold the project — never create the files manually.** The CLI produces the exact project structure these docs describe, correctly configured and with dependencies installed. Writing the scaffold by hand defeats the purpose of the tool and risks inconsistencies.

## Command

```bash
thatopen create <app-name>
```

Use `.` as the name to scaffold in the current directory:

```bash
thatopen create .
```

This copies the template files into the target directory and runs `npm install` automatically.

## Templates

Pass `--template <name>` to choose a template. The default is `bim`.

| Template | When to use |
|---|---|
| `bim` (default) | Standard BIM viewer app on the public engine libraries. |
| `bim-beta` | Same as `bim` but on the private **beta** engine libraries (`@thatopen-platform/*-beta`) — the line the platform currently runs. Use this for founding members (see below). |
| `default` | Minimal shell — just shows platform context. Use only when you explicitly want to start from scratch without any viewer. |

If no template is specified, use `bim`.

## Beta libraries (founding members) — use the `bim-beta` template

**Before scaffolding, ask the user whether they have beta access** and want the latest engine
libraries. If so, scaffold with the `bim-beta` template:

```bash
thatopen create <app-name> -t bim-beta
```

`bim-beta` is the `bim` viewer wired directly to the private `@thatopen-platform/*-beta` packages —
the **same library line the platform currently runs**. Prefer it whenever the user has beta access:
the public `bim` template uses older libraries that can error at runtime against a beta platform.

Founding members have **permanent** beta access. The beta packages are private, so the user must
have their beta access token configured in npm, or `npm install` will fail with a 401/403.

## What the scaffold produces

The `bim` template generates the full structure described in the **Project Structure** section of [./app-architecture.md](./app-architecture.md):

```
src/
├── bim-components/
├── ui-components/
├── setups/
├── app.ts
├── globals.ts
└── main.ts
```

All platform built-ins (`AppManager`, `UIManager`, `ViewportsManager`) are already wired up in the generated `main.ts`. There is nothing to manually wire at the entry point — just extend from there.

## Starting the dev server

After scaffolding, start the local dev server:

```bash
thatopen serve
```

This launches an esbuild watch process that rebundles on every file change and serves the app with live reload. No configuration needed.
