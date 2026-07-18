# biome-typescript-best-practices-plugin

## 1.2.2

### Patch Changes

- 361e9ed: Upgrade to TypeScript 7 with minor refactors.

## 1.2.1

### Patch Changes

- ae12dc5: fix(ts/no-inline-object-param-type): also flag destructured object parameters with inline types

  The rule previously only matched simple identifier bindings (`fn(obj: { ... })`). It now also matches destructured parameters (`fn({ a, b }: { ... })`), which are equally affected by the inline-type anti-pattern.

## 1.2.0

### Minor Changes

- 17f0c71: Add `ts/no-inline-object-return-type`: the return-type counterpart to `ts/no-inline-object-param-type`. Flags an inline object type used as a function's return type (`function fn(): { test: string }`). The plugin's top-level rule combinator changed from `or` to `any` so a function with **both** an inline param type and an inline return type reports both diagnostics instead of only the first.

  Both inline-object rules are **report-only** — they apply no `biome lint --write` fix. The fix ships instead as a pair of standalone fixer scripts you run with Bun (`fixers/extract-object-param-types.ts` and `fixers/extract-object-return-types.ts`). Each script runs Biome under the hood to read the rule's own diagnostics (so it fixes exactly what the rule flags, with the same scope), then rewrites the reported spans over a real TypeScript program: it fixes a whole file in one pass, derives collision-free alias names (`OParam`, `OParam2`, …), places each alias in the correct scope (block-local for nested functions; hoisted before the class for methods), and is idempotent. Supports `--dry-run` and `--help`. This avoids two GritQL `--write` limitations: the fix loop hangs on files with 2+ matches, and GritQL can't name aliases safely. `typescript` is now a peer dependency (used only by the fixers).

## 1.1.0

### Minor Changes

- 3cf06a9: Initial release. Six GritQL rules that fill gaps in Biome's recommended linter: `ts/no-as-cast`, `ts/no-in-operator`, `ts/no-empty-object-accumulator`, `ts/no-enum`, `ts/no-dynamic-delete`, and `ts/require-array-sort-compare`. All rules report diagnostics only (no auto-fix).
- 230be85: Add `ts/no-inline-object-param-type`: flags an inline object type on a function parameter (`function fn(obj: { test: string })`) and, with an **unsafe** auto-fix, extracts it to a named `type` alias declared just before the enclosing statement (`type ObjParam = { test: string }; function fn(obj: ObjParam)`). Covers function declarations, arrow functions, and function expressions bound in a variable statement. This is the plugin's first rule that ships an auto-fix.
