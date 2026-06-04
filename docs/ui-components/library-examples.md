# Library Examples

Before writing any BUI component implementation, check whether an official example covers the pattern you need. Official examples are the best starting point: they show correct usage of BUI elements, proper rendering patterns, and idiomatic API usage.

## How to find an example

1. Fetch the `paths.json` below. Do not summarize the response — retain the full JSON in context and use the descriptions to reason about which examples are relevant.
2. Use the descriptions in the JSON to reason about which examples best match the user's intent. Prefer semantic matching over path name matching — a description may cover what the user needs even if the component name doesn't match exactly.
3. Only proceed to fetch an example if its description confirms that it directly covers the user's intent, or that it can serve as a building block for composing a new custom component. Do not fetch speculatively.
4. Construct the full URL: `{base_url}{path_entry}` and fetch the example file to use as your implementation reference.

Note that some components have multiple examples for different use cases — `Table` for instance has separate entries for `Searching`, `Grouping`, `ExportingData`, and `DataTransform`. Check all relevant ones.

---

## Repository

### engine_ui-components
BUI primitives from `@thatopen/ui` — the `packages/core/` entries.

- **paths.json**: `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/examples/paths.json`
- **Base URL**: `https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/`

> The paths.json also contains entries under `packages/obc/` (OBC-connected tables and charts like `SpatialTree`, `ModelsList`, etc.). Those are also valid UI components — feel free to check them if the user needs that kind of structured data display.
