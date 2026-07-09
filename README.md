# biome-typescript-best-practices-plugin

[![npm version](https://img.shields.io/npm/v/biome-typescript-best-practices-plugin.svg)](https://www.npmjs.com/package/biome-typescript-best-practices-plugin)

A [Biome](https://biomejs.dev) plugin (written in
[GritQL](https://biomejs.dev/blog/gritql-biome)) that enforces TypeScript best
practices **not covered by Biome's recommended linter** — catching the patterns
that quietly bypass the type checker, walk the prototype chain, sort your numbers
wrong, or hide anonymous object types in your signatures.

It fills gaps that otherwise need
[`typescript-eslint`](https://typescript-eslint.io), and draws on
[`biome-plugin-no-type-assertion`](https://github.com/albertodeago/biome-plugin-no-type-assertion)
and the GritQL rules in
[felixarntz/biome](https://github.com/felixarntz/biome).

```ts
// flagged
const el = getEl() as HTMLInputElement; // `as` bypasses the type checker
if ("id" in obj) {} // `in` walks the prototype chain
items.reduce((acc, x) => acc, {}); // `{}` accumulator leaks prototype keys
enum Color { Red, Green } // enum emits runtime code
delete obj[key]; // dynamic delete deoptimises shape
[3, 20, 100].sort(); // lexicographic → [100, 20, 3]
function fn(o: { a: number }): { b: string } {} // inline object param/return types

// safe
const el = getEl(); // narrow with a type guard, or `satisfies`
if (Object.hasOwn(obj, "id")) {}
items.reduce((acc, x) => acc.set(x.k, x.v), new Map());
const Color = { Red: "red", Green: "green" } as const;
delete obj.prop; // static key is fine
[3, 20, 100].sort((a, b) => a - b);
type OParam = { a: number };
type FnReturn = { b: string };
function fn(o: OParam): FnReturn {} // extracted to named type aliases
```

## Contents

- [Rules](#rules)
  - [no-as-cast](#no-as-cast)
  - [no-in-operator](#no-in-operator)
  - [no-empty-object-accumulator](#no-empty-object-accumulator)
  - [no-enum](#no-enum)
  - [no-dynamic-delete](#no-dynamic-delete)
  - [require-array-sort-compare](#require-array-sort-compare)
  - [no-inline-object-param-type](#no-inline-object-param-type)
  - [no-inline-object-return-type](#no-inline-object-return-type)
- [Fixer scripts](#fixer-scripts)
  - [extract-object-param-types](#extract-object-param-types)
  - [extract-object-return-types](#extract-object-return-types)
- [Usage](#usage)
- [Try it](#try-it)
- [Tests](#tests)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Releasing](#releasing)

## Rules

| Rule | Flags | Why | Severity |
| --- | --- | --- | --- |
| `ts/no-as-cast` | `expr as T` type assertions (except `as const`) | `as` silences the type checker and can mask real type errors. | warn |
| `ts/no-in-operator` | the `in` operator and `for...in` | `in` walks the prototype chain, matching inherited/polluted keys. | warn |
| `ts/no-empty-object-accumulator` | `reduce(…, {})` / `reduceRight(…, {})` | A `{}` accumulator carries `Object.prototype`, so dynamic keys like `"__proto__"` leak in. | warn |
| `ts/no-enum` | `enum` and `const enum` declarations | Enums emit runtime code with surprising semantics; `const enum` breaks `isolatedModules`. | warn |
| `ts/no-dynamic-delete` | `delete obj[expr]` with a computed, non-literal key | Deleting a dynamic key deoptimises the object shape and usually means a `Map` was wanted. | warn |
| `ts/require-array-sort-compare` | `.sort()` / `.toSorted()` with no comparator | Default sort is by UTF-16 code unit, so numbers come out in the wrong order. | warn |
| `ts/no-inline-object-param-type` | an inline object type on a function parameter | Anonymous inline types can't be reused, show up nameless in errors/tooltips, and bloat signatures. | warn (fixable via fixer script) |
| `ts/no-inline-object-return-type` | an inline object type as a function's return type | Same hazards as the param rule, on the return side. | warn (fixable via fixer script) |

Every rule reports a diagnostic only (category `plugin`) — no rule applies a
`biome lint --write` auto-fix, because the correct repair is context-specific.
The two inline-object rules ship companion **fixer scripts** you run yourself;
see [Fixer scripts](#fixer-scripts).

These rules are intentionally **not** duplicates of Biome's recommended set
(which already covers `noExplicitAny`, `noNonNullAssertion`, `noDoubleEquals`,
and similar).

### no-as-cast

```ts
// flagged
const el = getEl() as HTMLInputElement;
const rec = (obj as Record<string, unknown>).key;
const twice = value as unknown as Target; // double assertion — flagged twice

// safe
const val = input as const; // `as const` narrows a literal, allowed
const ok = value satisfies Target; // `satisfies` validates without asserting
```

A type assertion tells the compiler "trust me" and switches off the very check
you installed TypeScript for. Only `as const` (literal narrowing) is exempt —
every other `as T` is flagged. A double assertion (`x as unknown as T`) is two
`TsAsExpression` nodes, so it reports twice. Inspired by
[`biome-plugin-no-type-assertion`](https://github.com/albertodeago/biome-plugin-no-type-assertion).

### no-in-operator

```ts
// flagged
if ("id" in obj) {}
for (const k in obj) {}

// safe
if (Object.hasOwn(obj, "id")) {}
for (const k of Object.keys(obj)) {}
```

The `in` operator and `for...in` both consult the prototype chain, so inherited
or prototype-polluted keys match. `Object.hasOwn` is an own-property check;
`Object.keys`/`Object.entries` with `for...of` iterate only own enumerable keys.
Inspired by
[felixarntz/biome's `no-in-operator`](https://github.com/felixarntz/biome/blob/main/rules/no-in-operator.grit).

### no-empty-object-accumulator

```ts
// flagged
items.reduce((acc, x) => { acc[x.k] = x.v; return acc; }, {});
items.reduceRight((acc, x) => acc, {});

// safe
items.reduce((acc, x) => acc.set(x.k, x.v), new Map());
items.reduce((acc, x) => acc + x, 0);
items.reduce((acc, x) => acc, { total: 0 }); // seeded object, not empty
```

Only an **empty** `{}` seed is flagged — that is the shape used for dynamic-key
aggregation, where a key like `"__proto__"` or `"constructor"` can collide with
`Object.prototype`. A `new Map()` or `Object.create(null)` has no such surface.
Inspired by
[felixarntz/biome's `no-empty-object-accumulator`](https://github.com/felixarntz/biome/blob/main/rules/no-empty-object-accumulator.grit).

### no-enum

```ts
// flagged
enum Color { Red, Green }
const enum Dir { Up, Down }

// safe
const Color = { Red: "red", Green: "green" } as const;
type Color = (typeof Color)[keyof typeof Color];
```

`enum` is one of the few TypeScript features that emits runtime code, and it has
surprising semantics (numeric enums are bidirectional maps; a value can be
assigned any number). `const enum` is erased but breaks under `isolatedModules` /
Babel / esbuild. A `const` object with `as const` plus a derived union is fully
erasable and behaves predictably.

### no-dynamic-delete

```ts
// flagged
delete obj[key];
delete cache[getId()];
delete registry[user.id];

// safe
delete obj.prop; // static member
delete obj["literal"]; // literal key
delete arr[0]; // literal index
```

Deleting a computed, non-literal key forces the engine to change the object's
hidden shape, deoptimising it, and usually signals that a `Map` (with
`.delete(key)`) was the right structure — or that the field should be modelled as
optional (`v?: T`). Static members and literal keys are left alone.

### require-array-sort-compare

```ts
// flagged
[3, 20, 100].sort(); // → [100, 20, 3]
numbers.toSorted();

// safe
[3, 20, 100].sort((a, b) => a - b);
strings.sort(); // NOTE: also flagged — see Limitations
```

`Array#sort` and `Array#toSorted` with no comparator coerce elements to strings
and compare by UTF-16 code unit, so `[3, 20, 100]` sorts to `[100, 20, 3]`.
Passing an explicit comparator makes the order intentional and correct.

### no-inline-object-param-type

```ts
// flagged
function fn(obj: { test: string; age: number }) {
  return obj.test;
}

// after the fixer script (see Fixer scripts)
type ObjParam = { test: string; age: number };
function fn(obj: ObjParam) {
  return obj.test;
}

// safe (nothing to extract)
type Named = { z: number };
function already(n: Named) {}
function destructured({ a, b }: { a: number; b: string }) {} // no name to derive — skipped
```

An object type inlined into a parameter list can't be reused, appears
anonymously in errors and tooltips (`{ test: string; age: number }` instead of
`ObjParam`), and bloats the signature. Extract it into a named `type` alias
declared just before the enclosing statement — TypeScript hoists type aliases, so
declaring it before the function is always valid.

The rule itself is **diagnostic-only**. The repair ships as a separate opt-in
fixer script you run yourself, so you decide when to apply it. See
[`extract-object-param-types`](#extract-object-param-types) under
[Fixer scripts](#fixer-scripts). Destructured params (`{ a, b }: { … }`) have no
name to derive an alias from and are left alone.

### no-inline-object-return-type

```ts
// flagged
function fn(): { test: string; age: number } {
  return { test: "a", age: 1 };
}

// after the fixer script (see Fixer scripts)
type FnReturn = { test: string; age: number };
function fn(): FnReturn {
  return { test: "a", age: 1 };
}

// safe (nothing to extract)
type Result = { z: number };
function named(): Result {} // already a named type
function inferred() { return 1; } // no return annotation
```

The return-type counterpart to
[`ts/no-inline-object-param-type`](#no-inline-object-param-type). An inline
object return type is anonymous in errors and tooltips and can't be reused;
extract it into a named `type` alias declared just before the enclosing
statement, named from the function or variable (`fn` → `FnReturn`,
`const build = (): { … }` → `BuildReturn`).

Also diagnostic-only, fixed by
[`extract-object-return-types`](#extract-object-return-types). A function with
**both** an inline param type and an inline return type is reported by both
rules (the plugin's top-level combinator is `any`, not `or`, so co-firing rules
both report); running both fixers extracts them together, giving a parameter and
its identically-typed return distinct aliases (`OParam` and `SameReturn`).

## Fixer scripts

The two inline-object rules flag a hazard whose repair is mechanical but **not
safely expressible as a Biome GritQL auto-fix**. Extracting a type needs two
coordinated edits — swap the inline type for a name *and* insert the alias before
the enclosing statement — and, as nested/overlapping edits, Biome's `--write` fix
loop cannot reconcile them: it spins forever once a file has 2+ matches. GritQL
also has no symbol table, so it can't derive collision-free names or find the
right scope for the alias. For those, the fix ships as a standalone script under
[fixers/](fixers/) that you run yourself, after Biome.

Fixers are shipped in the published package, so you can run them straight from
`node_modules` with [Bun](https://bun.sh):

```sh
# 1. let Biome apply its own fixes and formatting first
biome check --write .
# 2. then run a fixer over your source (paths default to ".")
bun run node_modules/biome-typescript-best-practices-plugin/fixers/<name>.ts [paths...]
```

Every fixer:

- **reads the plugin's own diagnostics** (it runs Biome under the hood), so it
  fixes exactly what the rule flags, with the same scope — never more.
- is **idempotent**: running it twice is a no-op, since an already-extracted site
  references a named type, not an inline object, so the rule no longer matches it.
- rewrites over a **real TypeScript program**: it fixes an entire file in one
  pass, derives collision-free names (`OParam`, `OParam2`, …), places each alias
  in the correct scope (a nested function gets a block-local alias; a class method
  hoists the alias just before the class), and leaves a parameter whose object
  text happens to match the return type untouched.
- supports **`--dry-run`** to preview changes without writing, and **`--help`**
  for usage.

Run them _after_ `biome check --write .` so Biome's formatting settles first; the
fixer's output is then tidied by Biome's formatter on your next
`biome check --write`.

> The fixers are plain TypeScript with a single `typescript` peer dependency (and
> they spawn your installed Biome). Prefer another runner? Point `tsx`/`ts-node`
> at the same `fixers/*.ts` entry points.

### extract-object-param-types

Applies the repair for
[`ts/no-inline-object-param-type`](#no-inline-object-param-type). For each
flagged inline object type on a parameter it extracts a `type` alias named from
the parameter (`obj` → `ObjParam`) and rewrites the annotation to reference it.

```sh
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-param-types.ts src
# preview only:
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-param-types.ts --dry-run src
```

### extract-object-return-types

Applies the repair for
[`ts/no-inline-object-return-type`](#no-inline-object-return-type). For each
flagged inline object return type it extracts a `type` alias named from the
function or variable (`fn` → `FnReturn`) and rewrites the return annotation to
reference it.

```sh
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-return-types.ts src
# preview only:
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-return-types.ts --dry-run src
```

## Usage

Install the plugin as a dev dependency:

```sh
npm install -D biome-typescript-best-practices-plugin
```

Reference it from your Biome configuration:

```jsonc
{
  "plugins": ["biome-typescript-best-practices-plugin/typescript.grit"],
  "linter": {
    "rules": { "recommended": true }
  }
}
```

Then run the linter:

```sh
npx @biomejs/biome lint <files>
```

Requires Biome **2.0+** (GritQL plugins landed in v2.0). Developed and tested
against Biome 2.5.

> Using it directly from this repo instead? Set
> `"plugins": ["./typescript.grit"]` and point the path at the checked-out file.

## Try it

```sh
npm install
npx @biomejs/biome lint example.ts
```

## Tests

Snapshot tests live in [tests/](tests/). Each case is a pair:
`tests/fixtures/<name>.ts` (the source to lint) and `<name>.expected.json` (the
diagnostics it should produce, as an order-independent array of
`{ "line": <number>, "rule": "<slug>" }`). The runner
([scripts/run-tests.mjs](scripts/run-tests.mjs)) runs `biome lint --reporter=json`
on each fixture with only the plugin enabled and compares the extracted
diagnostics against the expectation.

```sh
npm test
```

Every rule has a flagged fixture and a safe counterpart, covering the exempt
cases (`as const`, `Object.hasOwn`, seeded/`Map` accumulators, `const`-object
enums, literal-key deletes, comparator sorts, and already-named / destructured
object types).

Fixer scripts have their own unit tests (run with [Bun](https://bun.sh)),
covering the pure transform without spawning Biome:

```sh
bun test fixers/
```

## How it works

The plugin is one Biome GritQL file, [typescript.grit](typescript.grit).

- `no-as-cast` matches `TsAsExpression(ty = $type)` and excludes
  `$type <: TsReferenceType(name = \`const\`)` so `as const` passes.
- `no-in-operator` matches `JsInExpression` and `JsForInStatement`.
- `no-empty-object-accumulator` matches a `reduce`/`reduceRight` call whose second
  argument is a `JsObjectExpression` with an empty member list (`$members <: []`).
- `no-enum` matches `TsEnumDeclaration` (covers both `enum` and `const enum`).
- `no-dynamic-delete` matches `delete $target` where `$target` is a
  `JsComputedMemberExpression` whose key is not a string or number literal.
- `require-array-sort-compare` matches a `sort`/`toSorted` call with an empty
  argument list (`$args <: []`).
- `no-inline-object-param-type` matches a `JsFormalParameter` whose binding is a
  `JsIdentifierBinding` and whose annotation is a `TsObjectType`.
- `no-inline-object-return-type` matches a
  `TsReturnTypeAnnotation(ty = TsObjectType())`.
- The top-level combinator is `any` (not `or`), so a function with both an inline
  param type and an inline return type reports both diagnostics instead of only
  the first.

The two inline-object fixes live in [fixers/](fixers/), because GritQL is a poor
fit for them (see [Fixer scripts](#fixer-scripts) for why):

- [`fixers/lib.ts`](fixers/lib.ts) is the shared engine. `runBiome` spawns the
  consumer's Biome (`biome lint --reporter=json`) so the fixer sees exactly what
  the rule flags; `toOffset` converts each reported 1-based line/column into a
  string offset. The pure `planFileEdits(fileName, source, offsets)` parses the
  file with the TypeScript compiler, resolves each reported offset to its
  `TypeLiteralNode`, derives the alias kind from the node's position (parameter →
  `NameParam`, return slot → `FnReturn`), de-duplicates names, and applies all
  edits in one right-to-left pass — inserting each `type` alias before the nearest
  enclosing statement in a block-like scope. `runFixer` ties them together for the
  CLI. `planFileEdits` takes offsets (not Biome), so it is unit-tested without
  spawning the linter.
- [`extract-object-param-types.ts`](fixers/extract-object-param-types.ts) and
  [`extract-object-return-types.ts`](fixers/extract-object-return-types.ts) are
  thin entry points that call `runFixer` with their rule slug.

## Limitations

The plugin matches **structure, not types** — it keys off method and operator
shapes, not the static type of the receiver. Practical consequences:

- `ts/require-array-sort-compare` flags every argument-less `.sort()` /
  `.toSorted()`, including on `string[]` where the default order is fine. Add a
  comparator (`(a, b) => a.localeCompare(b)`) or suppress the line if the
  lexicographic default is intended.
- `ts/no-empty-object-accumulator` matches any `.reduce(fn, {})` regardless of
  receiver, and `ts/no-dynamic-delete` matches any `delete x[expr]`.
- Biome's GritQL plugins cannot yet take per-rule configuration, so the matches
  are intentionally broad. Scope the plugin with Biome's `includes` / `overrides`
  if false positives are a problem, or disable an individual rule by editing your
  copy of the `.grit` file.

## Releasing

Versions and the changelog are managed with
[Changesets](https://github.com/changesets/changesets).

1. Add a changeset describing a change: `npx changeset`.
2. Commit the changeset to your branch.
3. On merge to `main`, the [Release workflow](.github/workflows/release.yml) opens
   a "Version Packages" pull request that bumps the version and updates
   `CHANGELOG.md`.
4. Merge that PR and the workflow publishes the new version to npm.

The workflow needs an `NPM_TOKEN` secret in the repo. CI runs the test suite on
every push and pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

Inspired by
[`biome-plugin-no-type-assertion`](https://github.com/albertodeago/biome-plugin-no-type-assertion)
and the GritQL rules in
[felixarntz/biome](https://github.com/felixarntz/biome).
