// Shared codemod engine for the object-type extraction fixers.
//
// The Biome/GritQL rules `ts/no-inline-object-param-type` and
// `ts/no-inline-object-return-type` are diagnostic-only: they *report* every
// inline object type on a parameter / return position but leave the code
// untouched, because the repair (extract to a named `type` alias) needs
// scope-aware, collision-free naming that a GritQL `--write` rewrite can't do —
// and a nested "swap the type + prepend the alias" rewrite hangs Biome's fix
// loop on files with 2+ matches.
//
// This engine applies that repair. Like the react plugin's fixers, it runs Biome
// to collect the rule's diagnostics (so it fixes exactly what the rule matched,
// with the same scope), then rewrites each reported span with the TypeScript
// compiler — which supplies the parent context, enclosing statement, and symbol
// table that scope-aware, unique naming requires.
//
// Run via the sibling entry scripts (extract-object-param-types.ts /
// extract-object-return-types.ts), which call runFixer() here.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import ts from "typescript";

/** A 1-based line/column position, as reported by Biome's JSON reporter. */
interface Pos {
  line: number;
  column: number;
}

/** A resolved text edit: replace [start, end) with text (insertion when start === end). */
interface Edit {
  start: number;
  end: number;
  text: string;
  /** Push order, used to keep aliases stacked at one position in source order. */
  seq: number;
}

// ---------------------------------------------------------------------------
// Biome runner (locate the binary + parse the JSON report)
// ---------------------------------------------------------------------------

/** Locate the Biome binary the consumer already has installed. Prefer the local
 *  node_modules/.bin; fall back to a bare `biome` on PATH. */
function resolveBiome(): string {
  const local = join(process.cwd(), "node_modules", ".bin", "biome");
  return existsSync(local) ? local : "biome";
}

/** One diagnostic from `biome lint --reporter=json`. */
interface BiomeDiagnostic {
  category?: string;
  message?: string;
  location?: { path?: string; start?: Pos; end?: Pos };
}

/** Run `biome lint --reporter=json` on the given paths and return the parsed
 *  report. Biome exits non-zero whenever any diagnostic is emitted, so capture
 *  stdout regardless of exit code. */
export function runBiome(paths: readonly string[]): { diagnostics?: BiomeDiagnostic[] } {
  const biome = resolveBiome();
  let raw = "";
  try {
    raw = execFileSync(biome, ["lint", "--reporter=json", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    raw = (err as { stdout?: string }).stdout ?? "";
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write("fixer: could not parse Biome JSON output.\n");
    process.exit(1);
  }
}

/** Convert a 1-based {line, column} into a 0-based string offset for `source`.
 *  Biome columns count UTF-16 code units from 1, matching JS string indexing. */
export function toOffset(source: string, pos: Pos): number {
  let line = 1;
  let offset = 0;
  while (line < pos.line) {
    const nl = source.indexOf("\n", offset);
    if (nl === -1) return source.length;
    offset = nl + 1;
    line++;
  }
  return offset + (pos.column - 1);
}

// ---------------------------------------------------------------------------
// TypeScript-compiler transform (turn reported spans into scope-aware edits)
// ---------------------------------------------------------------------------

const capitalize = (s: string): string => s.replace(/^[a-z]/, (c) => c.toUpperCase());

/** Pick the script kind so `.tsx` parses JSX and `.ts` doesn't. */
function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** The TypeLiteralNode that starts at `offset` (the `{` Biome reported), or
 *  undefined if none does — e.g. the source drifted from the diagnostics. */
function typeLiteralAt(sf: ts.SourceFile, offset: number): ts.TypeLiteralNode | undefined {
  let found: ts.TypeLiteralNode | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isTypeLiteralNode(node) && node.getStart(sf) === offset) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Name of the function-like node for return-type aliases (fn -> "Fn"). */
function functionName(node: ts.SignatureDeclaration): string | undefined {
  // Named function / method: `function fn()`, `class { m() {} }`.
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name))
    return node.name.text;
  // Arrow / function expression bound to a name: `const build = () => …`,
  // `const build = function () {}`, or an object/class member.
  const parent = node.parent;
  if (parent !== undefined) {
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name))
      return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  }
  return undefined;
}

/** Derive the desired alias name from a reported object type's position in the
 *  tree: a parameter annotation → `NameParam`; a function return slot →
 *  `FnReturn`. Returns undefined for a shape neither rule reports. */
function desiredName(objType: ts.TypeLiteralNode): string | undefined {
  const parent = objType.parent;
  // Parameter position: `fn(obj: { … })` — parent is the parameter, and the
  // object type is its `type` annotation (not, say, a default value).
  if (ts.isParameter(parent) && parent.type === objType && ts.isIdentifier(parent.name))
    return `${capitalize(parent.name.text)}Param`;
  // Return position: parent is a function-like whose `type` is the object type.
  if (isSignatureLike(parent) && parent.type === objType) {
    const base = functionName(parent);
    return base !== undefined ? `${capitalize(base)}Return` : "FnReturn";
  }
  return undefined;
}

/** A function-like node that has a return-type slot we can extract from. */
function isSignatureLike(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  );
}

/** Walk up to the statement whose parent is a block-like scope, so a `type`
 *  alias inserted before it is syntactically valid (never inside a class body
 *  or parameter list). Returns undefined if no such host exists. */
function hostStatement(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node = node;
  while (current.parent !== undefined) {
    const parent = current.parent;
    if (ts.isStatement(current) && (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent))) return current;
    current = parent;
  }
  return undefined;
}

/** The indentation (leading whitespace) of the line containing `pos`. */
function indentOf(source: string, pos: number): string {
  const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
  let end = lineStart;
  while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
  return source.slice(lineStart, end);
}

/** Append a numeric suffix until the name is free (`ObjParam`, `ObjParam2`, …). */
function uniqueName(desired: string, used: ReadonlySet<string>): string {
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired}${n}`)) n++;
  return `${desired}${n}`;
}

/** Apply non-overlapping edits right-to-left so earlier offsets stay valid.
 *  Ties at one offset (several aliases stacked before the same statement) break
 *  by `seq` descending, so the lower-seq edit is applied last and ends up leftmost
 *  — preserving source order in the emitted alias block. */
function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end || b.seq - a.seq);
  let out = source;
  for (const edit of ordered) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** Result of rewriting one source file. */
export interface PlanResult {
  /** The rewritten source (identical to input when `count` is 0). */
  output: string;
  /** Number of inline object types extracted. */
  count: number;
}

/**
 * Rewrite one TypeScript source, given the offsets Biome reported for this file
 * (each the `{` of a flagged inline object type). PURE — takes offsets, not
 * Biome — so it is unit-testable without spawning the linter.
 *
 * For each offset it finds the object type node, derives the alias kind from the
 * node's position (parameter → `NameParam`, return slot → `FnReturn`), then
 * extracts it into a `type` alias declared just before the enclosing statement.
 * Names are de-duplicated against existing names and each other with numeric
 * suffixes, and each alias is placed in the object type's own scope (nested
 * functions get a block-local alias; a class method hoists before the class), so
 * the output type-checks in a single pass.
 */
export function planFileEdits(fileName: string, source: string, offsets: readonly number[]): PlanResult {
  if (offsets.length === 0) return { output: source, count: 0 };
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKind(fileName));

  // Names already taken in the file, so generated aliases never collide.
  const used = new Set<string>();
  const collectNames = (node: ts.Node): void => {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && ts.isIdentifier(node.name))
      used.add(node.name.text);
    ts.forEachChild(node, collectNames);
  };
  collectNames(sf);

  // Resolve each reported offset to a planned extraction, in source order so the
  // generated names read predictably.
  const plans = [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => {
      const objType = typeLiteralAt(sf, offset);
      if (objType === undefined) return undefined;
      const wanted = desiredName(objType);
      if (wanted === undefined) return undefined;
      const host = hostStatement(objType);
      if (host === undefined) return undefined;
      const hostStart = host.getStart(sf);
      return {
        typeStart: objType.getStart(sf),
        typeEnd: objType.getEnd(),
        body: source.slice(objType.getStart(sf), objType.getEnd()),
        insertPos: hostStart,
        indent: indentOf(source, hostStart),
        wanted,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  if (plans.length === 0) return { output: source, count: 0 };

  const edits: Edit[] = [];
  let seq = 0;
  for (const p of plans) {
    const name = uniqueName(p.wanted, used);
    used.add(name);
    // Replace the inline object type with the alias name...
    edits.push({ start: p.typeStart, end: p.typeEnd, text: name, seq: seq++ });
    // ...and insert the alias declaration before the host statement.
    edits.push({ start: p.insertPos, end: p.insertPos, text: `type ${name} = ${p.body};\n${p.indent}`, seq: seq++ });
  }

  return { output: applyEdits(source, edits), count: plans.length };
}

// ---------------------------------------------------------------------------
// CLI runner (shared by both entry scripts)
// ---------------------------------------------------------------------------

/** Configuration for one fixer's CLI entry point. */
export interface FixerConfig {
  /** The rule slug this fixer repairs, e.g. "no-inline-object-param-type". */
  rule: string;
  /** Human name shown in usage/output ("object parameter types"). */
  label: string;
  /** Script basename for the usage line ("extract-object-param-types.ts"). */
  scriptName: string;
}

/**
 * Shared entry point for the fixer scripts. Runs Biome to collect THIS rule's
 * diagnostics (so the fixer touches exactly what the rule flags, with the same
 * scope), groups the reported spans by file, and rewrites each with
 * `planFileEdits`. Idempotent: an already-extracted site no longer matches the
 * rule, so re-running is a no-op.
 *
 * Flags: `--dry-run` previews without writing; `--help` prints usage. Paths
 * default to the current directory.
 */
export function runFixer(argv: readonly string[], config: FixerConfig): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        `Extract inline ${config.label} flagged by ts/${config.rule} into named \`type\` aliases.`,
        "",
        "Usage:",
        `  bun run node_modules/biome-typescript-best-practices-plugin/fixers/${config.scriptName} [paths...]`,
        "",
        "Run it after `biome check --write .`. Paths default to the current directory.",
        "",
        "Flags:",
        "  --dry-run   show what would change without writing",
        "  --help, -h  this message",
        "",
      ].join("\n"),
    );
    return;
  }

  const dryRun = argv.includes("--dry-run");
  const paths = argv.filter((a) => !a.startsWith("-"));
  if (paths.length === 0) paths.push(".");

  const report = runBiome(paths);
  const relevant = (report.diagnostics ?? []).filter(
    (d) => d.category === "plugin" && (d.message ?? "").includes(`[ts/${config.rule}]`),
  );

  if (relevant.length === 0) {
    process.stdout.write(`${config.scriptName}: nothing to fix.\n`);
    return;
  }

  // Group each diagnostic's start offset by file.
  const byFile = new Map<string, Pos[]>();
  for (const d of relevant) {
    const p = d.location?.path;
    const start = d.location?.start;
    if (p === undefined || start === undefined) continue;
    const list = byFile.get(p);
    if (list) list.push(start);
    else byFile.set(p, [start]);
  }

  let totalExtractions = 0;
  let changedFiles = 0;
  for (const [file, positions] of byFile) {
    const source = readFileSync(file, "utf8");
    const offsets = positions.map((pos) => toOffset(source, pos));
    const { output, count } = planFileEdits(file, source, offsets);
    if (count === 0) continue;
    changedFiles++;
    totalExtractions += count;
    if (dryRun) process.stdout.write(`  would fix ${count} in ${file}\n`);
    else {
      writeFileSync(file, output, "utf8");
      process.stdout.write(`  fixed ${count} in ${file}\n`);
    }
  }

  const verb = dryRun ? "would extract" : "extracted";
  process.stdout.write(
    `\n${config.scriptName}: ${verb} ${totalExtractions} inline ${config.label} across ${changedFiles} file(s).\n`,
  );
}
