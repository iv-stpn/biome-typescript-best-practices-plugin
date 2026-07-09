# biome-typescript-best-practices-plugin

## 1.1.0

### Minor Changes

- 3cf06a9: Initial release. Six GritQL rules that fill gaps in Biome's recommended linter: `ts/no-as-cast`, `ts/no-in-operator`, `ts/no-empty-object-accumulator`, `ts/no-enum`, `ts/no-dynamic-delete`, and `ts/require-array-sort-compare`. All rules report diagnostics only (no auto-fix).
- 230be85: Add `ts/no-inline-object-param-type`: flags an inline object type on a function parameter (`function fn(obj: { test: string })`) and, with an **unsafe** auto-fix, extracts it to a named `type` alias declared just before the enclosing statement (`type ObjParam = { test: string }; function fn(obj: ObjParam)`). Covers function declarations, arrow functions, and function expressions bound in a variable statement. This is the plugin's first rule that ships an auto-fix.
