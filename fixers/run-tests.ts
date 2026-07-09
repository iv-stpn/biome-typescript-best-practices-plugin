// Table-driven tests for the object-type extraction codemod (fixers/lib.ts).
//
// Each case feeds an input source through transformSource() with a set of
// ExtractOptions and asserts the exact rewritten output. Run with:
//   bun run fixers/run-tests.ts
import process from "node:process";
import { type ExtractOptions, transformSource } from "./lib.ts";

interface Case {
  name: string;
  options: ExtractOptions;
  input: string;
  expected: string;
}

const PARAMS: ExtractOptions = { params: true, returns: false };
const RETURNS: ExtractOptions = { params: false, returns: true };
const BOTH: ExtractOptions = { params: true, returns: true };

const cases: Case[] = [
  {
    name: "param: function declaration",
    options: PARAMS,
    input: `function fn(obj: { test: string; age: number }) {\n\treturn obj.test;\n}\n`,
    expected: `type ObjParam = { test: string; age: number };\nfunction fn(obj: ObjParam) {\n\treturn obj.test;\n}\n`,
  },
  {
    name: "param: arrow in variable statement",
    options: PARAMS,
    input: `const arrow = (o: { a: number }) => o.a;\n`,
    expected: `type OParam = { a: number };\nconst arrow = (o: OParam) => o.a;\n`,
  },
  {
    name: "param: two object params, one pass",
    options: PARAMS,
    input: `function two(a: { p: number }, b: { q: string }) {}\n`,
    expected: `type AParam = { p: number };\ntype BParam = { q: string };\nfunction two(a: AParam, b: BParam) {}\n`,
  },
  {
    name: "param: dedupe same name across functions",
    options: PARAMS,
    input: `function f1(o: { a: number }) {}\nfunction f2(o: { b: string }) {}\n`,
    expected: `type OParam = { a: number };\nfunction f1(o: OParam) {}\ntype OParam2 = { b: string };\nfunction f2(o: OParam2) {}\n`,
  },
  {
    name: "param: skip destructured and already-named",
    options: PARAMS,
    input: `function d({ a }: { a: number }) {}\nfunction n(x: Named) {}\ntype Named = { z: number };\n`,
    expected: `function d({ a }: { a: number }) {}\nfunction n(x: Named) {}\ntype Named = { z: number };\n`,
  },
  {
    name: "return: function declaration",
    options: RETURNS,
    input: `function fn(): { test: string } {\n\treturn { test: "a" };\n}\n`,
    expected: `type FnReturn = { test: string };\nfunction fn(): FnReturn {\n\treturn { test: "a" };\n}\n`,
  },
  {
    name: "return: arrow uses variable name",
    options: RETURNS,
    input: `const build = (): { a: number } => ({ a: 1 });\n`,
    expected: `type BuildReturn = { a: number };\nconst build = (): BuildReturn => ({ a: 1 });\n`,
  },
  {
    name: "return: skip named and inferred",
    options: RETURNS,
    input: `function named(): Result { return { z: 1 }; }\ntype Result = { z: number };\nfunction inferred() { return 1; }\n`,
    expected: `function named(): Result { return { z: 1 }; }\ntype Result = { z: number };\nfunction inferred() { return 1; }\n`,
  },
  {
    name: "both: param + return on one function, distinct names, param untouched by return",
    options: BOTH,
    input: `function same(o: { a: number }): { a: number } {\n\treturn o;\n}\n`,
    expected: `type OParam = { a: number };\ntype SameReturn = { a: number };\nfunction same(o: OParam): SameReturn {\n\treturn o;\n}\n`,
  },
  {
    name: "nested: alias scoped to the enclosing block",
    options: PARAMS,
    input: `function outer() {\n\tconst inner = (p: { z: boolean }) => p.z;\n\treturn inner;\n}\n`,
    expected: `function outer() {\n\ttype PParam = { z: boolean };\n\tconst inner = (p: PParam) => p.z;\n\treturn inner;\n}\n`,
  },
  {
    name: "class method: alias hoisted before the class",
    options: RETURNS,
    input: `class C {\n\tm(): { n: string } {\n\t\treturn { n: "x" };\n\t}\n}\n`,
    expected: `type MReturn = { n: string };\nclass C {\n\tm(): MReturn {\n\t\treturn { n: "x" };\n\t}\n}\n`,
  },
];

let failures = 0;
for (const c of cases) {
  const { output } = transformSource("test.ts", c.input, c.options);
  if (output === c.expected) process.stdout.write(`  ✓ ${c.name}\n`);
  else {
    failures++;
    process.stdout.write(`  ✗ ${c.name}\n`);
    process.stdout.write(`    --- expected ---\n${indent(c.expected)}\n`);
    process.stdout.write(`    --- actual ---\n${indent(output)}\n`);
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `    | ${l}`)
    .join("\n");
}

process.stdout.write(
  `\n${failures === 0 ? "all passing" : `${failures} failing`}: ${cases.length - failures}/${cases.length} fixer cases\n`,
);
process.exit(failures === 0 ? 0 : 1);
