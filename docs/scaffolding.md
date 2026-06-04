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
| `bim` (default) | Standard BIM viewer app — Three.js viewport, BIM viewer, platform UI components. This is the right starting point for almost every app. |
| `default` | Minimal shell — just shows platform context. Use only when you explicitly want to start from scratch without any viewer. |

If no template is specified, use `bim`.

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
