#!/usr/bin/env bun
// Fixer for `ts/no-inline-object-return-type`.
//
// Extracts every inline object type used as a function return type into a named
// `type` alias declared just before the enclosing statement:
//
//   function fn(): { test: string; age: number } { … }
//   // becomes
//   type FnReturn = { test: string; age: number };
//   function fn(): FnReturn { … }
//
// Usage:
//   bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-return-types.ts src
//   bun run …/extract-object-return-types.ts --check src   # CI: exit 1 if any change
import process from "node:process";
import { runCli } from "./lib.ts";

runCli(process.argv.slice(2), {
  label: "object return types",
  extract: { params: false, returns: true },
  scriptName: "extract-object-return-types.ts",
});
