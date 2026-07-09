#!/usr/bin/env bun
// Fixer for `ts/no-inline-object-param-type`.
//
// Extracts every inline object type on a function parameter into a named `type`
// alias declared just before the enclosing statement:
//
//   function fn(obj: { test: string; age: number }) { … }
//   // becomes
//   type ObjParam = { test: string; age: number };
//   function fn(obj: ObjParam) { … }
//
// Usage:
//   bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-param-types.ts src
//   bun run …/extract-object-param-types.ts --check src   # CI: exit 1 if any change
import process from "node:process";
import { runCli } from "./lib.ts";

runCli(process.argv.slice(2), {
  label: "object parameter types",
  extract: { params: true, returns: false },
  scriptName: "extract-object-param-types.ts",
});
