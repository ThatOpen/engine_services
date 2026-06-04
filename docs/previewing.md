# Previewing Apps During Development

That Open Platform apps can only be previewed correctly within the platform context — opening `localhost:4000` directly in the browser will just bring the app bundle. The app must be loaded from inside a project on the platform as it gives context.

---

## Step 1: Start the dev server

In the project root, run:

```bash
npm run dev
```

This invokes `thatopen serve` under the hood — the same CLI installed during setup. It performs a special build and serves the bundle on **port 4000**. Keep this process running throughout your development session.

---

## Step 2: Open the app in the platform

Once the dev server is running:

1. Go to [https://dev.platform.thatopen.com](https://dev.platform.thatopen.com) and enter a project. If no project exists yet, create one first.
2. In the project sidebar, click **Local App**.
3. Click **Get Started**.

The platform will load the locally-running app from port 4000 and render it inside the project context, with full access to its models, data, and users.

The resulting URL follows this pattern:

```
https://dev.platform.thatopen.com/dashboard/projects/{projectId}/apps/local-app
```

where `{projectId}` is the ID of the project. Bookmark this URL to return quickly during development.

> The dev server must be running before opening this URL. If the bundle is not being served on port 4000, the platform will fail to load the app.

---

## When to read this guide

- When you want to see, run, or preview the app
- When you have run `npm run dev` and don't know what to do next
- When the app is not showing up in the platform
