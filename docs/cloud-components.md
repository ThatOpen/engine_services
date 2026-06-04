# Cloud components & automations

A **cloud component** is a piece of logic that runs **server-side** (Node.js) on the platform,
on the shared project context, via the API. Use them to automate real operations — clash checks,
validations, document generation — and to let apps offload heavy work.

## Apps vs cloud components

|  | Apps | Cloud components |
|---|---|---|
| **Runs in** | Browser (iframe on the platform) | Server (Node.js child process) |
| **Item type** | `APP` | `TOOL` |
| **Entry point** | Side effects in `main.ts` (renders UI) | `export async function main()` |
| **Build output** | IIFE `dist/bundle.js` (all deps bundled) | IIFE `dist/bundle.js` (only `@thatopen/services` externalized) |
| **Template** | `bim`, `default`, `test` | `cloud`, `cloud-test` |

## Scaffold

```bash
thatopen create my-component --template cloud
cd my-component
```

The component is an `export async function main()` that runs on the server. The execution engine
injects these globals (do **not** import them; for `OBC`/`THREE`/`web-ifc` import them so the
bundler includes them):

| Global | Purpose |
|--------|---------|
| `thatOpenServices` | Authenticated `EngineServicesClient` |
| `executionParams` | Parameters passed by the caller |
| `executionContext` | `{ projectId?, executionId, toolId, toolVersion }` |
| `executionReporter` | `{ message(msg), error(msg), progress(pct) }` for live feedback |
| `OBC` | `@thatopen/components` — BIM engine (import it) |
| `THREE` | `three` — 3D math/geometry (import it) |
| `fs` | Node.js filesystem (import it) |

## Run locally

```bash
npm run run                                 # build + test locally
npx thatopen run --params '{"inputFile":"model.ifc"}'   # pass parameters
```

`thatopen local-server` starts an API-compatible local execution server (default `:4001`) so an
app can call the component before it's deployed (set `client.localServerUrl`).

## Authenticate & publish

```bash
npm run login -- --token <your-token>
npm run publish
```

## Calling a component from an app

```ts
const { executionId } = await client.executeComponent(componentId, { param: "value" }, versionTag?);
client.onExecutionProgress(executionId, (data) => {
  // data.progressUpdate — percentage
  // data.messageUpdate — status messages
});
```

Include `projectId` in the execution params to scope the run to a project (the backend validates
the component is linked to that project). See [CONTEXT.md](../CONTEXT.md) for the permissions contract.

## Automations (event-triggered components)

An **automation** is a cloud component that runs automatically in response to a platform **event**
(rather than being invoked by hand) — e.g. "run the clash check whenever a model is updated."
The component is the same; what differs is the trigger. Add it to a project, choose the event(s)
that fire it, and the platform executes it on the shared project context, reporting progress and
logs through `executionReporter`. Build and publish it exactly like any other cloud component above.
