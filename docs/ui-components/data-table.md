# Data Table

> **Structural rule:** A `<bim-table>` always lives in its own dedicated UI component (e.g., `collisionsTable`, `elementsTable`). Never define a table inline inside another template such as a `panel-section`. The consuming template receives the table component as an external reference and composes it in.

`BUI.Table<TData>` is the standard component for displaying tabular data. `TData` is a record type where each key is a column name and each value is the cell's data type.

## Data Type

Define a named type following the `{PascalCase(identifier)}Data` convention and export it from `src/types.ts`:

```ts
export type MyComponentTableData = {
  Name: string
  Count: number
  Actions: string  // reserved for per-row interaction buttons
}
```

`Actions: string` is the conventional column for per-row interaction buttons — typed as `string` (placeholder) and rendered via `dataTransform`.

Column names follow a casing rule: **PascalCase** for columns displayed to the user (`Name`, `Count`), **camelCase** for internal data columns not meant to be shown (`id`, `modelId`).

## Template

The table element is created via `BUI.html` and configured imperatively once mounted using `BUI.ref`:

```ts
export const myTableTemplate: BUI.StatefullComponent<MyTableState> = ({ components }) => {
  const onCreated = (e?: Element) => {
    if (!e) return
    const table = e as BUI.Table<MyTableData>
    table.loadFunction = async () => {
      // return BUI.TableGroupData<MyTableData>[]
    }
    table.loadData(true)
  }

  return BUI.html`
    <bim-table ${BUI.ref(onCreated)}></bim-table>
  `
}
```

**For async data** — assign `loadFunction` and call `loadData()`. Passing `true` forces a fresh fetch. `loadData()` does nothing if data already exists — to re-trigger, first reset: `table.data = []`.

**For synchronous data** — assign `table.data` directly:

```ts
table.data = items.map(item => ({ data: { Name: item.name, Count: item.count } }))
```

### Data Structure

```ts
{
  data: { Name: "Juan", Count: 5 },  // required
  children?: [...]                    // optional — nested rows
}
```

The preferred pattern for hierarchical data is a **flat list combined with `groupedBy`**. Reserve `children` for fixed, explicit hierarchies.

## Empty State

```ts
return BUI.html`
  <bim-table ${BUI.ref(onCreated)}>
    <div slot="missing-data" style="display: flex; flex-direction: column; align-items: center;">
      <bim-label>No data loaded.</bim-label>
      <bim-button @click=${() => table.loadData()} label="Load Data"></bim-button>
    </div>
  </bim-table>
`
```

## Error State

```ts
return BUI.html`
  <bim-table ${BUI.ref(onCreated)}>
    <div slot="error-loading" style="display: flex; flex-direction: column; align-items: center;">
      <bim-label data-table-element="error-message"></bim-label>
      <bim-button @click=${() => table.loadData()} label="Try Again"></bim-button>
    </div>
  </bim-table>
`
```

## Column Configuration and dataTransform

Column layout, visibility, and `dataTransform` are fixed properties — configure them in `onInstanceCreated`, not in the template.

```ts
table.headersHidden = true
table.noIndentation = true
table.columns = [
  "Name",
  "Count",
  { name: "Actions", width: "auto" },
]
table.groupedBy = ["Type"]
table.preserveStructureOnFilter = true

table.dataTransform = {
  Name: (value) => BUI.html`<bim-label>${value}</bim-label>`,
  Actions: (_, rowData) => {
    const { id } = rowData
    if (!id) return _
    return BUI.html`<bim-button @click=${() => doSomething(id)}></bim-button>`
  }
}
```

> `noIndentation` and `groupedBy` are incompatible.

**Column visibility:**
```ts
table.visibleColumns = ["Name", "Actions"]  // most columns hidden
table.hiddenColumns = ["id", "extension"]   // most columns visible
```

> Everything rendered inside a table lives in the Shadow DOM. CSS classes cannot be applied — all styling must use inline styles.

`rowData` can be mutated directly inside a transform:

```ts
table.dataTransform = {
  LoadBearing: (value, rowData) => {
    const onChange = (e: Event) => {
      const input = e.target
      if (!(input instanceof BUI.Checkbox)) return
      rowData.LoadBearing = input.checked
    }
    return BUI.html`<bim-checkbox @change=${onChange} .checked=${value}></bim-checkbox>`
  }
}
```

## Grouping

```ts
table.groupedBy = ["Discipline", "State"]  // apply
table.groupedBy = []                        // clear
```

`groupingTransform` maps column values to arrays defining multi-level hierarchy:

```ts
table.groupingTransform = {
  State: (value) => {
    if (value === "S0") return ["Work in Progress"]
    if (value.includes(".")) return ["Shared States", parentState, value]
    return ["Shared States", value]
  }
}
```

`BUI.Table.flattenData` flattens a nested group structure — useful for computing aggregate values:

```ts
const children = BUI.Table.flattenData(group.data.children)
const total = children.reduce((sum, { data }) => sum + (Number(data.Count) || 0), 0)
```

## Row Events (rowcreated)

```ts
const rowHandlers = new WeakMap<Element, { handleClick: () => void }>()

table.addEventListener("rowcreated", (e) => {
  if (!("detail" in e)) return
  const { row } = (e as { detail: BUI.RowCreatedEventDetail<MyTableData> }).detail

  const existing = rowHandlers.get(row)
  if (existing) row.removeEventListener("click", existing.handleClick)

  const handleClick = () => {
    if (!row.groupData?.data) return
    const { Name } = row.groupData.data
  }

  rowHandlers.set(row, { handleClick })
  row.addEventListener("click", handleClick)
})
```
