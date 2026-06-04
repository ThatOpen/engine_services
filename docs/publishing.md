# Publishing an App

Publishing to the That Open Platform is a two-step process: authenticate first, then publish.

## Step 1: Authenticate

```bash
thatopen login
```

This stores credentials globally at `~/.thatopen/config.json`. Authentication persists across sessions — you only need to do this once per machine.

**Options:**

| Flag | Purpose |
|---|---|
| `--token <token>` | Non-interactive login (CI, scripts) |
| `--local` | Store credentials in the project directory (`.thatopen`) instead of globally |

## Step 2: Publish

```bash
thatopen publish
```

This builds the app and uploads it to the platform. The command handles the build step automatically unless told otherwise.

**Common options:**

| Flag | Purpose |
|---|---|
| `--name <name>` | Override the published app name |
| `--version-tag <tag>` | Tag the release (e.g. `v1.2.0`) |
| `--skip-build` | Skip the build step if the bundle is already built |
| `--app-id <id>` | Publish to a specific existing app |
