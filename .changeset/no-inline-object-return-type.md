---
"biome-typescript-best-practices-plugin": minor
---

Add `ts/no-inline-object-return-type`: the return-type counterpart to `ts/no-inline-object-param-type`. Flags an inline object type used as a function's return type (`function fn(): { test: string }`) and, with an **unsafe** auto-fix, extracts it to a named `type` alias declared just before the enclosing statement (`type FnReturn = { test: string }; function fn(): FnReturn`). The alias name is derived from the function or variable name (`fn` → `FnReturn`). Covers function declarations, arrow functions, and function expressions bound in a variable statement.

The plugin's top-level rule combinator changed from `or` to `any` so a function with **both** an inline param type and an inline return type reports both diagnostics (and, under `--write --unsafe`, is fixed across successive passes until neither remains) instead of only the first.
