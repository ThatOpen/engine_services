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

Publishing is **manual** via `npm`. From `main` with a clean working tree:

```bash
npm version patch --no-git-tag-version   # bump package.json (default to a patch)
npm publish                              # prepublishOnly runs the full build first
git commit -am "chore(release): @thatopen/services <version>"
git push
```

Keep semver in mind, but default to a **patch** unless a maintainer explicitly
calls for a minor or major.
