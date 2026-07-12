---
"biome-typescript-best-practices-plugin": patch
---

fix(ts/no-inline-object-param-type): also flag destructured object parameters with inline types

The rule previously only matched simple identifier bindings (`fn(obj: { ... })`). It now also matches destructured parameters (`fn({ a, b }: { ... })`), which are equally affected by the inline-type anti-pattern.
