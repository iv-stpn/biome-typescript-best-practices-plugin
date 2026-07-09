---
"biome-typescript-best-practices-plugin": minor
---

Add `ts/no-inline-object-return-type`: the return-type counterpart to `ts/no-inline-object-param-type`. Flags an inline object type used as a function's return type (`function fn(): { test: string }`). The plugin's top-level rule combinator changed from `or` to `any` so a function with **both** an inline param type and an inline return type reports both diagnostics instead of only the first.

Both inline-object rules are **report-only** — they apply no `biome lint --write` fix. The fix ships instead as a pair of standalone TypeScript codemods run with Bun (`fixers/extract-object-param-types.ts` and `fixers/extract-object-return-types.ts`, with `--check`/`--dry` flags). Running over a real TypeScript program, the codemod fixes a whole file in one pass, derives collision-free alias names (`OParam`, `OParam2`, …), places each alias in the correct scope (block-local for nested functions; hoisted before the class for methods), and is idempotent. This avoids two GritQL `--write` limitations: the fix loop hangs on files with 2+ matches, and GritQL can't name aliases safely. `typescript` is now a peer dependency (used only by the fixers).
