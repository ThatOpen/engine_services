# Library Examples

Before writing any implementation that uses That Open Engine — whether you know the component name or are trying to figure out how to achieve something — check whether an official example covers it. Official examples are the best starting point: they show correct initialization sequences, idiomatic API usage, and working patterns from the source authors.

## How to find an example

1. Fetch the `paths.json` for each repo below (you can do all three in parallel). Do not summarize the response — retain the full JSON in context and use the descriptions to reason about which examples are relevant.
2. Use the descriptions in the JSON to reason about which examples best match the user's intent. Prefer semantic matching over path name matching — a description may cover what the user needs even if the component name doesn't match exactly.
3. Only proceed to fetch an example if its description confirms that it directly covers the user's intent, or that it can serve as a building block for composing a new custom component. Do not fetch speculatively.
4. Construct the full URL: `{base_url}{path_entry}` and fetch the example file to use as your implementation reference.

Path names are descriptive — `VisibilityOperations`, `EditElements`, `SteelDetailing` — so matching by intent works well even when the user hasn't named a specific component.

---

## Repositories

### engine_components
Components from `@thatopen/components` (OBC) and `@thatopen/components-front` (OBF).

- **paths.json**: `https://raw.githubusercontent.com/ThatOpen/engine_components/refs/heads/main/examples/paths.json`
- **Base URL**: `https://raw.githubusercontent.com/ThatOpen/engine_components/refs/heads/main/`

### engine_fragment
The `@thatopen/fragments` low-level library. There are no named OBC components here — users typically describe what they want to do (e.g., "edit model properties", "modify elements", "work with visibility").

- **paths.json**: `https://raw.githubusercontent.com/ThatOpen/engine_fragment/refs/heads/main/examples/paths.json`
- **Base URL**: `https://raw.githubusercontent.com/ThatOpen/engine_fragment/refs/heads/main/`
