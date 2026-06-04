# Access Backend Data

## Accessing backend data via `AppManager`

After `init()`, `AppManager` exposes:

- **`app.client`** — `EngineServicesClient`: backend client for API calls
- **`app.projectData`** — `ProjectData`: current user info, role, project metadata

Both are resolved before any setup runs. Always access them through `getAppManager(components)`:

```ts
const app = getAppManager(components)
if (app.projectData.currentUser?.role.name === "Project Admin") {
  // render admin-only controls
}

const files = await app.client.getProjectFiles(app.projectData.id)
```
