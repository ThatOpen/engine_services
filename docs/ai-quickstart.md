# That Open Platform — AI Quick Start (zero to a running app or cloud component)

You are an AI assistant. A user pointed you at this URL so you can scaffold and run something
on the [That Open Platform](https://platform.thatopen.com) from scratch, using
`@thatopen/services` (the `thatopen` CLI + client library). Follow the steps below in order.

> The only secret you need is a **platform API token** — **not** an npm token. The CLI
> derives private beta-registry access from the platform token automatically.

---

## First — what are you building? (ask if the user hasn't said)

There are two kinds of project. **If the user hasn't told you which they want, ASK them
before scaffolding** — explain it in plain terms and let them pick:

- **App** — something people *open and click around in*, running in the platform's browser
  UI: a 3D BIM viewer, a dashboard, a form, a custom tool. Choose this when the goal is a
  visual interface. Template: `app`.
- **Cloud component** — *server-side logic* with no UI of its own, running in the platform's
  cloud and triggered by an app or an automation to do work on the project's data — e.g.
  convert a file (IFC→fragments, point cloud→tiles), generate a report, run a calculation.
  Choose this when the goal is processing/automation, not a screen. Template: `cloud-component`.

Steps 0–2 are identical for both; they diverge only at `create` (step 3) and how you run them
(step 4). This guide marks **[app]** / **[component]** where they differ.

## 0. Prerequisites (check, don't assume)

- **Node.js ≥ 18** and **npm** — verify with `node -v`.
- A **That Open Platform API token**. The user creates it themselves:
  → **https://platform.thatopen.com/dashboard/data → API Tokens → create → copy.**
  Ask the user to paste it. **Never print it back, never write it into a file, never commit it.**

## 1. Install the CLI

```bash
npm install -g @thatopen/services@latest
```

## 2. Log in (do this BEFORE creating the project)

Get the token from the platform dashboard — **https://platform.thatopen.com/dashboard/data**
→ **API Tokens** → create → copy. Ask the user to paste it, then run:

```bash
thatopen login --token <platform-token>
```

This validates the token and stores it in `~/.thatopen/config.json`. Login **must** come
first: the next step's install pulls the private `@thatopen-platform/*-beta` packages, and
`create` uses your logged-in token to write an authenticated `.npmrc` so that install can
resolve them. No npm account or manual npm token is involved.

## 3. Scaffold a beta project

**[app]**
```bash
thatopen create my-app --beta
cd my-app
```

**[component]**
```bash
thatopen create my-component -t cloud-component --beta
cd my-component
```

`--beta` is required for now (the templates use engine APIs that currently live only in the
beta libraries; public support lands with the October release). `create` configures private
beta access from your platform token and runs `npm install` for you. The **app** scaffold is
a complete working viewer; the **cloud-component** scaffold is a `main()` entry point plus a
`declarations.json` (the parameters the component accepts) — read its `README.md`, which
explains the exactly-four globals the cloud engine injects (do NOT import them) and how to
read/write the project's data.

## 4. Run it

**[app]**
```bash
npm run dev
```
Serves the app and opens it inside the platform. **You now have a complete, working viewer** —
model loading, spatial tree, properties, measurement, sectioning, and more.

**[component]**
```bash
npm run run        # executes the component locally against the platform (no browser)
```
Runs `main()` in a local emulation of the cloud engine so you can iterate before publishing.

## 5. Then build — read the in-project agent guide

The scaffold is real, working code — a complete viewer **[app]** or a runnable `main()`
**[component]** — not a blank page. **Before changing anything**, open and follow:

```
node_modules/@thatopen/services/resources/AGENTS.md
```

(The scaffolded project's own `AGENTS.md` points here too.) It is the canonical guide for
**both** project types: it indexes every platform built-in, the client API, the CLI, and the
engine / UI example sets. Load those indexes before writing code. For an **app**, **all UI
must be built with Lit + `@thatopen/ui` (`BUI`)** — consult the design system first. Run the
scaffold first, then extend it; don't rebuild from scratch.

## 6. Publish (when ready)

```bash
npm run publish
```

Builds, zips (`dist/bundle.zip`), and uploads a new version to the platform — for an **app**
or a **component** (a component also ships its `declarations.json`). Re-run it any time to
push a new version.

Once published, it shows up at **https://platform.thatopen.com/dashboard/data** — an **app**
under **Apps**, a **cloud component** under **Components**. Either way it isn't running
anywhere yet: to actually use it, **add it to one of your projects** from there. (A cloud
component, once added to a project, is then triggered by an app or an automation in it.)

---

## Rules for you, the assistant

- **Platform token only.** Never introduce, request, or store an npm token.
- **Never echo or persist the user's token.** It belongs only in `~/.thatopen/config.json` /
  `.npmrc`, both of which the CLI manages and git-ignores.
- **Propose a short plan and get the user's OK** before changing files.
- The scaffold already works — **extend it, don't replace it.**
