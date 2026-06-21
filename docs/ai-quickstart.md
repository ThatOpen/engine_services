# That Open Platform — AI Quick Start (zero to a running app)

You are an AI assistant. A user pointed you at this URL so you can scaffold and run a
**BIM app** on the [That Open Platform](https://platform.thatopen.com) from scratch, using
`@thatopen/services` (the `thatopen` CLI + client library). Follow the steps below in order.

> The only secret you need is a **platform API token** — **not** an npm token. The CLI
> derives private beta-registry access from the platform token automatically.

---

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

## 3. Scaffold a beta app

```bash
thatopen create my-app --beta
cd my-app
```

`--beta` is required for now: the bundled viewer uses engine APIs that currently live only
in the beta libraries (public engine support lands with the October release). `create`
configures private beta access from your platform token and runs `npm install` for you.

## 4. Run it

```bash
npm run dev
```

This serves the app and opens it inside the platform. **You now have a complete, working
viewer** — model loading, spatial tree, properties, measurement, sectioning, and more.

## 5. Then build — read the in-project agent guide

The scaffold is a real app, not a blank page. **Before changing anything**, open and follow:

```
node_modules/@thatopen/services/resources/AGENTS.md
```

(The scaffolded project's own `AGENTS.md` points here too.) It is the canonical guide: it
indexes every platform built-in, the client API, the CLI, and the engine / UI example sets.
Load those indexes before writing code. **All UI must be built with Lit + `@thatopen/ui`
(`BUI`)** — consult the design system before writing any UI. Run the app first, then extend
it; don't rebuild a viewer from scratch.

## 6. Publish (when ready)

```bash
npm run publish
```

Builds the app, zips it (`dist/bundle.zip`), and uploads a new version to the platform.

---

## Rules for you, the assistant

- **Platform token only.** Never introduce, request, or store an npm token.
- **Never echo or persist the user's token.** It belongs only in `~/.thatopen/config.json` /
  `.npmrc`, both of which the CLI manages and git-ignores.
- **Propose a short plan and get the user's OK** before changing files.
- The scaffold already works — **extend it, don't replace it.**
