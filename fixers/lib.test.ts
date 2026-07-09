// Unit tests for the object-type extraction codemod's pure transform.
// Run with: bun test fixers/lib.test.ts
//
// These cover planFileEdits — the function that turns Biome-reported spans into
// scope-aware, collision-free `type` alias extractions — without spawning Biome.
// Each case computes the offsets planFileEdits expects (the `{` of every inline
// object type) directly from the source, the way runFixer does from Biome's
// diagnostics, so the tests are fast and deterministic.
import { describe, expect, test } from "bun:test";
import { planFileEdits } from "./lib.ts";

// Offsets of every inline object type literal in `source`, found the way Biome
// reports them: the position of each `{ … }` that annotates a param or return.
// We locate them by a marker substring so each case stays readable.
function offsetsOf(source: string, markers: readonly string[]): number[] {
  return markers.map((m) => {
    const at = source.indexOf(m);
    if (at === -1) throw new Error(`marker not found: ${m}`);
    return at;
  });
}

// Run planFileEdits against the object types identified by `markers`.
function run(source: string, markers: readonly string[]): string {
  return planFileEdits("test.ts", source, offsetsOf(source, markers)).output;
}

describe("param extraction", () => {
  test("function declaration → alias before the function", () => {
    const src = `function fn(obj: { test: string; age: number }) {\n\treturn obj.test;\n}\n`;
    expect(run(src, ["{ test: string; age: number }"])).toBe(
      `type ObjParam = { test: string; age: number };\nfunction fn(obj: ObjParam) {\n\treturn obj.test;\n}\n`,
    );
  });

  test("arrow in a variable statement → alias before the statement", () => {
    const src = `const arrow = (o: { a: number }) => o.a;\n`;
    expect(run(src, ["{ a: number }"])).toBe(`type OParam = { a: number };\nconst arrow = (o: OParam) => o.a;\n`);
  });

  test("two object params in one function, one pass", () => {
    const src = `function two(a: { p: number }, b: { q: string }) {}\n`;
    expect(run(src, ["{ p: number }", "{ q: string }"])).toBe(
      `type AParam = { p: number };\ntype BParam = { q: string };\nfunction two(a: AParam, b: BParam) {}\n`,
    );
  });

  test("same param name across functions → de-duplicated names", () => {
    const src = `function f1(o: { a: number }) {}\nfunction f2(o: { b: string }) {}\n`;
    expect(run(src, ["{ a: number }", "{ b: string }"])).toBe(
      `type OParam = { a: number };\nfunction f1(o: OParam) {}\ntype OParam2 = { b: string };\nfunction f2(o: OParam2) {}\n`,
    );
  });
});

describe("return extraction", () => {
  test("function declaration → alias named from the function", () => {
    // The return `{ test: string }` is the first `{` in the source (the body's
    // `{ test: "a" }` object literal comes later), so indexOf finds the right one.
    const src = `function fn(): { test: string } {\n\treturn { test: "a" };\n}\n`;
    expect(run(src, ["{ test: string }"])).toBe(
      `type FnReturn = { test: string };\nfunction fn(): FnReturn {\n\treturn { test: "a" };\n}\n`,
    );
  });

  test("arrow return → alias named from the variable", () => {
    const src = `const build = (): { a: number } => ({ a: 1 });\n`;
    expect(run(src, ["{ a: number }"])).toBe(`type BuildReturn = { a: number };\nconst build = (): BuildReturn => ({ a: 1 });\n`);
  });
});

describe("scope and placement", () => {
  test("nested function → alias scoped to the enclosing block", () => {
    const src = `function outer() {\n\tconst inner = (p: { z: boolean }) => p.z;\n\treturn inner;\n}\n`;
    expect(run(src, ["{ z: boolean }"])).toBe(
      `function outer() {\n\ttype PParam = { z: boolean };\n\tconst inner = (p: PParam) => p.z;\n\treturn inner;\n}\n`,
    );
  });

  test("class method return → alias hoisted before the class", () => {
    const src = `class C {\n\tm(): { n: string } {\n\t\treturn { n: "x" };\n\t}\n}\n`;
    expect(run(src, ["{ n: string }"])).toBe(
      `type MReturn = { n: string };\nclass C {\n\tm(): MReturn {\n\t\treturn { n: "x" };\n\t}\n}\n`,
    );
  });

  test("param and return sharing object text → distinct names, param untouched by return", () => {
    const src = `function same(o: { a: number }): { a: number } {\n\treturn o;\n}\n`;
    // Two identical `{ a: number }` texts: the first is the param, the second the return.
    const paramAt = src.indexOf("{ a: number }");
    const returnAt = src.indexOf("{ a: number }", paramAt + 1);
    expect(planFileEdits("test.ts", src, [paramAt, returnAt]).output).toBe(
      `type OParam = { a: number };\ntype SameReturn = { a: number };\nfunction same(o: OParam): SameReturn {\n\treturn o;\n}\n`,
    );
  });
});

describe("no-op safety", () => {
  test("no offsets → source unchanged", () => {
    const src = `function fn(n: Named) {}\ntype Named = { z: number };\n`;
    expect(planFileEdits("test.ts", src, []).output).toBe(src);
  });

  test("offset that resolves to no reportable shape → skipped", () => {
    // Offset pointing at a non-object-type place yields no extraction.
    const src = `const x = 1;\n`;
    expect(planFileEdits("test.ts", src, [0]).output).toBe(src);
  });
});
