// Fixer for `ts/no-inline-object-return-type`.
//
// The plugin rule is diagnostic-only: it reports every inline object type used
// as a function's return type but leaves the code untouched, because the repair
// (naming the type, placing the alias in the right scope, avoiding collisions)
// needs a symbol table Biome's GritQL does not have.
//
// This script applies that repair. It runs Biome to collect the rule's
// diagnostics (so it sees exactly what the rule matched, with the same scope),
// then extracts each reported inline object type into a named `type` alias
// declared just before the enclosing statement:
//
//   function fn(): { test: string; age: number } { … }
//   // becomes
//   type FnReturn = { test: string; age: number };
//   function fn(): FnReturn { … }
//
// Run it AFTER `biome check --write .` (so formatting/other fixes settle first):
//   bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-return-types.ts [paths...]
//
// Flags:
//   --dry-run   show what would change without writing
//   --help      usage
//
// Idempotent: an already-extracted return references a named type, not an inline
// object, so the rule no longer matches it and the script skips it.
import process from "node:process";
import { runFixer } from "./lib.ts";

const CONFIG = {
  rule: "no-inline-object-return-type",
  label: "object return types",
  scriptName: "extract-object-return-types.ts",
} as const;

// Only run when executed directly (`bun run …`), not when imported by a test.
if (require.main === module) runFixer(process.argv.slice(2), CONFIG);
