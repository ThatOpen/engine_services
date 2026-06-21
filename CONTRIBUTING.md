## Development (working on this repo)

### Setup

```bash
npm install
npm run build        # Builds both library and CLI
```

### Build commands

```bash
npm run build          # Full build (library + CLI)
npm run build:lib      # Library only
npm run build:cli      # CLI only
```

### Publishing a new version

Publishing is handled automatically by CI when a PR with changesets is merged to `main`.

**1. Create a changeset (developer does this with their changes):**

```bash
yarn changeset
# Pick the bump type (patch / minor / major) and write a summary
# This creates a .changeset/<random-name>.md file — commit it with your PR
```

**2. Merge the PR to `main`:**

CI will automatically:
- Consume the changeset files
- Bump `package.json` version and update `CHANGELOG.md`
- Commit the version bump back to `main`
- Build and publish to npm

**Manual publishing (if CI is not available):**

```bash
yarn version           # Consume changesets, bump version
yarn build
yarn changeset publish
```

Keep in mind the importance of semver — don't release a major for non-breaking changes.
