---
"biome-typescript-best-practices-plugin": patch
---

Move `@typescript/typescript6` from `devDependencies` to `dependencies` so the
fixer scripts work out of the box for consumers — installing the plugin now
provides the TypeScript compiler the fixers need, with no extra install step.
