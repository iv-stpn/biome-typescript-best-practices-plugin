# biome-typescript-best-practices-plugin

[![npm](https://img.shields.io/npm/v/biome-typescript-best-practices-plugin.svg)](https://www.npmjs.com/package/biome-typescript-best-practices-plugin)

A [Biome](https://biomejs.dev) plugin (written in [GritQL](https://biomejs.dev/blog/gritql-biome)) that
enforces TypeScript best practices **not covered by Biome's recommended linter** — catching the patterns
that quietly bypass the type checker, walk the prototype chain, or sort your numbers wrong.

```ts
// flagged
const el = getEl() as HTMLInputElement;          // `as` bypasses the type checker
if ("id" in obj) {}                              // `in` walks the prototype chain
items.reduce((acc, x) => acc, {});               // `{}` accumulator leaks prototype keys
enum Color { Red, Green }                        // enum emits runtime code
delete obj[key];                                 // dynamic delete deoptimises shape
[3, 20, 100].sort();                             // lexicographic → [100, 20, 3]
function fn(o: { a: number }): { b: string } {}  // inline object param/return types (fixable via script)

// safe
const el = getEl();                              // narrow with a type guard, or `satisfies`
if (Object.hasOwn(obj, "id")) {}
items.reduce((acc, x) => acc.set(x.k, x.v), new Map());
const Color = { Red: "red", Green: "green" } as const;
delete obj.prop;                                 // static key is fine
[3, 20, 100].sort((a, b) => a - b);
type OParam = { a: number };
type FnReturn = { b: string };
function fn(o: OParam): FnReturn {}              // extracted to named type aliases
```

## Rules

| Rule | Flags | Why |
| --- | --- | --- |
| `ts/no-as-cast` | `expr as T` type assertions (except `as const`) | `as` silences the type checker and can mask real type errors. |
| `ts/no-in-operator` | the `in` operator and `for...in` | `in` walks the prototype chain, matching inherited/polluted keys. |
| `ts/no-empty-object-accumulator` | `reduce(…, {})` / `reduceRight(…, {})` | A `{}` accumulator carries `Object.prototype`, so dynamic keys like `"__proto__"` leak in. |
| `ts/no-enum` | `enum` and `const enum` declarations | Enums emit runtime code with surprising semantics; `const enum` breaks `isolatedModules`. |
| `ts/no-dynamic-delete` | `delete obj[expr]` with a computed, non-literal key | Deleting a dynamic key deoptimises the object shape and usually means a `Map` was wanted. |
| `ts/require-array-sort-compare` | `.sort()` / `.toSorted()` with no comparator | Default sort is by UTF-16 code unit, so numbers come out in the wrong order. |
| `ts/no-inline-object-param-type` | an inline object type on a function parameter | Anonymous inline types can't be reused, show up nameless in errors/tooltips, and bloat signatures. **Fixable with a script.** |
| `ts/no-inline-object-return-type` | an inline object type as a function's return type | Same hazards as the param rule, on the return side. **Fixable with a script.** |

All rules report a diagnostic (severity `warn`, category `plugin`) and apply **no** `biome lint --write` fix —
the correct repair is context-specific, so the plugin flags the hazard and leaves the fix to you. Two rules,
`ts/no-inline-object-param-type` and `ts/no-inline-object-return-type`, have a mechanical fix that ships as a
standalone codemod you run with [Bun](https://bun.sh) — see [Fixing inline object types](#fixing-inline-object-types).

These rules are intentionally **not** duplicates of Biome's recommended set (which already covers
`noExplicitAny`, `noNonNullAssertion`, `noDoubleEquals`, and similar). They fill gaps that otherwise need
`typescript-eslint`.

### ts/no-as-cast

```ts
// flagged
const el = getEl() as HTMLInputElement;
const rec = (obj as Record<string, unknown>).key;
const twice = value as unknown as Target;   // double assertion — flagged twice

// safe
const val = input as const;                 // `as const` narrows a literal, allowed
const ok = value satisfies Target;          // `satisfies` validates without asserting
```

A type assertion tells the compiler "trust me" and switches off the very check you installed TypeScript
for. Only `as const` (literal narrowing) is exempt — every other `as T` is flagged. A double assertion
(`x as unknown as T`) is two `TsAsExpression` nodes, so it reports twice. Inspired by
[`biome-plugin-no-type-assertion`](https://github.com/albertodeago/biome-plugin-no-type-assertion).

### ts/no-in-operator

```ts
// flagged
if ("id" in obj) {}
for (const k in obj) {}

// safe
if (Object.hasOwn(obj, "id")) {}
for (const k of Object.keys(obj)) {}
```

The `in` operator and `for...in` both consult the prototype chain, so inherited or prototype-polluted keys
match. `Object.hasOwn` is an own-property check; `Object.keys`/`Object.entries` with `for...of` iterate only
own enumerable keys. Inspired by
[felixarntz/biome's `no-in-operator`](https://github.com/felixarntz/biome/blob/main/rules/no-in-operator.grit).

### ts/no-empty-object-accumulator

```ts
// flagged
items.reduce((acc, x) => { acc[x.k] = x.v; return acc; }, {});
items.reduceRight((acc, x) => acc, {});

// safe
items.reduce((acc, x) => acc.set(x.k, x.v), new Map());
items.reduce((acc, x) => acc + x, 0);
items.reduce((acc, x) => acc, { total: 0 });   // seeded object, not empty
```

Only an **empty** `{}` seed is flagged — that is the shape used for dynamic-key aggregation, where a key like
`"__proto__"` or `"constructor"` can collide with `Object.prototype`. A `new Map()` or `Object.create(null)`
has no such surface. Inspired by
[felixarntz/biome's `no-empty-object-accumulator`](https://github.com/felixarntz/biome/blob/main/rules/no-empty-object-accumulator.grit).

### ts/no-enum

```ts
// flagged
enum Color { Red, Green }
const enum Dir { Up, Down }

// safe
const Color = { Red: "red", Green: "green" } as const;
type Color = (typeof Color)[keyof typeof Color];
```

`enum` is one of the few TypeScript features that emits runtime code, and it has surprising semantics (numeric
enums are bidirectional maps; a value can be assigned any number). `const enum` is erased but breaks under
`isolatedModules` / Babel / esbuild. A `const` object with `as const` plus a derived union is fully erasable
and behaves predictably.

### ts/no-dynamic-delete

```ts
// flagged
delete obj[key];
delete cache[getId()];
delete registry[user.id];

// safe
delete obj.prop;        // static member
delete obj["literal"];  // literal key
delete arr[0];          // literal index
```

Deleting a computed, non-literal key forces the engine to change the object's hidden shape, deoptimising it,
and usually signals that a `Map` (with `.delete(key)`) was the right structure — or that the field should be
modelled as optional (`v?: T`). Static members and literal keys are left alone.

### ts/require-array-sort-compare

```ts
// flagged
[3, 20, 100].sort();      // → [100, 20, 3]
numbers.toSorted();

// safe
[3, 20, 100].sort((a, b) => a - b);
strings.sort();           // NOTE: also flagged — see limitations
```

`Array#sort` and `Array#toSorted` with no comparator coerce elements to strings and compare by UTF-16 code
unit, so `[3, 20, 100]` sorts to `[100, 20, 3]`. Passing an explicit comparator makes the order intentional
and correct.

### ts/no-inline-object-param-type

```ts
// flagged
function fn(obj: { test: string; age: number }) {
  return obj.test;
}

// after the fixer script (see "Fixing" below)
type ObjParam = { test: string; age: number };
function fn(obj: ObjParam) {
  return obj.test;
}

// safe (nothing to extract)
type Named = { z: number };
function already(n: Named) {}
function destructured({ a, b }: { a: number; b: string }) {}   // no name to derive — skipped
```

An object type inlined into a parameter list can't be reused, appears anonymously in errors and tooltips
(`{ test: string; age: number }` instead of `ObjParam`), and bloats the signature. Extract it into a named
`type` alias declared immediately before the enclosing statement. TypeScript hoists type aliases, so declaring
the alias before the function is always valid.

The rule itself only **reports** — it applies no `biome lint --write` fix. The fix is a separate codemod you
run with [Bun](https://bun.sh), [`extract-object-param-types.ts`](fixers/extract-object-param-types.ts) (see
[Fixing](#fixing)). It handles function declarations and arrow / function expressions bound in a variable
statement, derives the alias name from the parameter (`obj` → `ObjParam`), and de-duplicates names that collide
(`OParam`, `OParam2`, …). Destructured params (`{ a, b }: { … }`) have no name to derive from and are skipped.

### ts/no-inline-object-return-type

```ts
// flagged
function fn(): { test: string; age: number } {
  return { test: "a", age: 1 };
}

// after the fixer script (see "Fixing" below)
type FnReturn = { test: string; age: number };
function fn(): FnReturn {
  return { test: "a", age: 1 };
}

// safe (nothing to extract)
type Result = { z: number };
function named(): Result {}         // already a named type
function inferred() { return 1; }   // no return annotation
```

The return-type counterpart to `ts/no-inline-object-param-type`. An inline object return type is anonymous in
errors and tooltips and can't be reused; extract it into a named `type` alias declared just before the
enclosing statement. The alias name is derived from the function or variable name (`fn` → `FnReturn`,
`const build = (): { … }` → `BuildReturn`).

Also **report-only**, fixed by the companion codemod
[`extract-object-return-types.ts`](fixers/extract-object-return-types.ts) (see [Fixing](#fixing)). It covers
function declarations and arrow / function expressions bound in a variable statement. A function with **both**
an inline param type and an inline return type is reported by both rules; running both fixers (or the codemod
with both extractions enabled) fixes them together, giving a parameter and its identically-typed return
distinct aliases (`OParam` and `SameReturn`).

## Fixing

The two inline-object rules **report only** — `biome lint --write` (even `--write --unsafe`) applies nothing.
The fix is a pair of standalone [TypeScript](https://www.typescriptlang.org) codemods you run with
[Bun](https://bun.sh), shipped inside the package under `fixers/`:

```sh
# extract inline object PARAMETER types → named `type` aliases
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-param-types.ts src

# extract inline object RETURN types
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-return-types.ts src
```

Each takes any mix of files and directories (directories are walked; `node_modules`, `.git`, build output,
and `.d.ts` files are skipped) and rewrites them in place. Flags:

- `--check` — write nothing; exit `1` if any file *would* change (use in CI).
- `--dry` — write nothing; print what would change.

```sh
# CI guard: fail if anything still has inline object param types
bun run node_modules/biome-typescript-best-practices-plugin/fixers/extract-object-param-types.ts --check src
```

**Why a codemod instead of `biome lint --write`?** A GritQL `--write` rewrite is the wrong tool for this
particular fix on two counts, both of which the codemod sidesteps:

- **It hangs.** Extracting a type needs two edits — swap the inline type for a name *and* prepend the alias to
  the enclosing statement. As nested/overlapping edits, Biome's `--write` fix loop cannot reconcile them and
  spins forever once a file has 2+ matches.
- **It can't name safely.** GritQL has no symbol table, so it can't dedupe collisions (two params named `o`
  would both become `type OParam`) or know which names are already taken.

The codemod runs over a real TypeScript program: it fixes an entire file in one pass, derives collision-free
names (`OParam`, `OParam2`, …), places each alias in the correct scope (nested functions get a block-local
alias; class methods hoist the alias just before the class), and leaves a parameter whose object text happens
to match the return type untouched. The output is idempotent and type-checks.

> Prefer not to add Bun? The codemod is plain TypeScript with a single `typescript` peer dependency — run it
> with any TS runner (`tsx`, `ts-node`, or compile it) by pointing at the same `fixers/*.ts` entry points.

## Limitations

The plugin matches **structure, not types** — it keys off method and operator shapes, not the static type of
the receiver. Practical consequences:

- `ts/require-array-sort-compare` flags every argument-less `.sort()` / `.toSorted()`, including on
  `string[]` where the default order is fine. Add a comparator (`(a, b) => a.localeCompare(b)`) or suppress
  the line if the lexicographic default is intended.
- `ts/no-empty-object-accumulator` matches any `.reduce(fn, {})` regardless of receiver, and
  `ts/no-dynamic-delete` matches any `delete x[expr]`.
- Biome's GritQL plugins cannot yet take per-rule configuration, so the matches are intentionally broad. Scope
  the plugin with Biome's `includes` / `overrides` if false positives are a problem, or disable an individual
  rule by editing your copy of the `.grit` file.

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

Requires Biome **2.0+** (GritQL plugins landed in v2.0). Developed and tested against Biome 2.5.

> Using it directly from this repo instead? Set `"plugins": ["./typescript.grit"]` and point the path at the
> checked-out file.

## Try it

```sh
npm install
npx @biomejs/biome lint example.ts
```

## Tests

Snapshot tests live in [tests/](tests/). Each case is a pair: `tests/fixtures/<name>.ts` (the source to lint)
and `<name>.expected.json` (the diagnostics it should produce, as an order-independent array of
`{ "line": <number>, "rule": "<slug>" }`). The runner ([scripts/run-tests.mjs](scripts/run-tests.mjs)) runs
`biome lint --reporter=json` on each fixture with only the plugin enabled and compares the extracted
diagnostics against the expectation.

```sh
npm test
```

Every rule has a flagged fixture and a safe counterpart, covering the exempt cases (`as const`,
`Object.hasOwn`, seeded/`Map` accumulators, `const`-object enums, literal-key deletes, and comparator sorts).

## How it works

The plugin is one Biome GritQL file, [typescript.grit](typescript.grit).

- `no-as-cast` matches `TsAsExpression(ty = $type)` and excludes `$type <: TsReferenceType(name = \`const\`)`
  so `as const` passes.
- `no-in-operator` matches `JsInExpression` and `JsForInStatement`.
- `no-empty-object-accumulator` matches a `reduce`/`reduceRight` call whose second argument is a
  `JsObjectExpression` with an empty member list (`$members <: []`).
- `no-enum` matches `TsEnumDeclaration` (covers both `enum` and `const enum`).
- `no-dynamic-delete` matches `delete $target` where `$target` is a `JsComputedMemberExpression` whose key is
  not a string or number literal.
- `require-array-sort-compare` matches a `sort`/`toSorted` call with an empty argument list (`$args <: []`).
- `no-inline-object-param-type` matches a `JsFormalParameter` whose binding is a `JsIdentifierBinding` and
  whose annotation is a `TsObjectType`, and reports on that type node.
- `no-inline-object-return-type` matches a `TsReturnTypeAnnotation(ty = TsObjectType())` and reports on that
  type node.
- The top-level combinator is `any` (not `or`), so a function with both an inline param type and an inline
  return type reports both diagnostics instead of only the first.

Both inline-object rules are **report-only**: GritQL is a poor fit for their fix (a nested "swap the type +
prepend an alias" rewrite hangs Biome's `--write` loop on files with 2+ matches, and GritQL can't derive
collision-free, scope-aware alias names). The fix instead lives in [fixers/](fixers/) — standalone
TypeScript-compiler codemods run with Bun:

- [`fixers/lib.ts`](fixers/lib.ts) is the shared engine. It parses the file, collects existing type/interface
  names, walks the AST for inline object types on parameters (`fn(o: { … })`) and return positions
  (`fn(): { … }`), derives an alias name (`obj` → `ObjParam`, `fn` → `FnReturn`), de-duplicates against
  existing and generated names with numeric suffixes, and applies all edits right-to-left in one pass —
  inserting each `type` alias before the nearest enclosing statement in a block-like scope (so nested-function
  and class-method aliases land in a valid place).
- [`extract-object-param-types.ts`](fixers/extract-object-param-types.ts) and
  [`extract-object-return-types.ts`](fixers/extract-object-return-types.ts) are thin CLIs over `runCli`.

## Releasing

Versions and the changelog are managed with [Changesets](https://github.com/changesets/changesets).

1. Add a changeset describing a change: `npx changeset`.
2. Commit the changeset to your branch.
3. On merge to `main`, the [Release workflow](.github/workflows/release.yml) opens a "Version Packages" pull
   request that bumps the version and updates `CHANGELOG.md`.
4. Merge that PR and the workflow publishes the new version to npm.

The workflow needs an `NPM_TOKEN` secret in the repo. CI runs the test suite on every push and pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

---

Inspired by [`biome-plugin-no-type-assertion`](https://github.com/albertodeago/biome-plugin-no-type-assertion)
and the GritQL rules in [felixarntz/biome](https://github.com/felixarntz/biome).
