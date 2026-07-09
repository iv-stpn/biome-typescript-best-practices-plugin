// Shared codemod engine for the object-type extraction fixers.
//
// The Biome/GritQL rules `ts/no-inline-object-param-type` and
// `ts/no-inline-object-return-type` only *report* inline object types — they
// apply no auto-fix (a GritQL `--write` rewrite hangs Biome's fix loop on files
// with 2+ matches, and can't do scope-aware, collision-free naming). These
// fixers do the rewrite instead, using the TypeScript compiler API, so the whole
// file is fixed in a single pass with unique alias names.
//
// Run via the sibling CLI scripts (extract-object-param-types.ts /
// extract-object-return-types.ts), which call transformSource()/runCli() here.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import ts from "typescript";

/** Which inline object types to extract. */
export interface ExtractOptions {
  /** Extract inline object types on function parameters (`fn(o: { … })`). */
  params: boolean;
  /** Extract inline object types used as a return type (`fn(): { … }`). */
  returns: boolean;
}

/** A single planned extraction, before edits are materialised. */
interface Extraction {
  /** Source offset where the inline object type starts. */
  typeStart: number;
  /** Source offset where the inline object type ends. */
  typeEnd: number;
  /** Verbatim text of the object type (becomes the alias body). */
  body: string;
  /** Offset of the enclosing statement (after its indentation). */
  insertPos: number;
  /** Leading indentation of that statement, repeated for the alias line. */
  indent: string;
  /** Preferred alias name before de-duplication. */
  desiredName: string;
}

/** A resolved text edit: replace [start, end) with text (insertion when start === end). */
interface Edit {
  start: number;
  end: number;
  text: string;
  /** Push order, used to keep aliases stacked at one position in source order. */
  seq: number;
}

const capitalize = (s: string): string => s.replace(/^[a-z]/, (c) => c.toUpperCase());

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
function indentOf(source: ts.SourceFile, pos: number): string {
  const text = source.text;
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  let end = lineStart;
  while (end < text.length && (text[end] === " " || text[end] === "\t")) end++;
  return text.slice(lineStart, end);
}

/** Extract the inline object type node from a param/return position, or
 *  undefined if the annotation isn't a bare object type literal. */
function objectTypeOf(annotation: ts.TypeNode | undefined): ts.TypeLiteralNode | undefined {
  return annotation !== undefined && ts.isTypeLiteralNode(annotation) ? annotation : undefined;
}

/** Result of transforming one source file. */
export interface TransformResult {
  /** The rewritten source (identical to input when `changed` is false). */
  output: string;
  /** Number of inline object types extracted. */
  count: number;
  /** Whether any extraction was applied. */
  changed: boolean;
}

/**
 * Rewrite a single TypeScript source: extract each inline object type on a
 * function parameter and/or return type into a named `type` alias declared
 * immediately before the enclosing statement.
 *
 * Alias names are derived deterministically (param `obj` -> `ObjParam`, function
 * `fn` -> `FnReturn`) and de-duplicated against existing names and each other
 * with numeric suffixes, so the output always type-checks in one pass.
 */
export function transformSource(fileName: string, source: string, options: ExtractOptions): TransformResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKind(fileName));

  // Names already taken in the file, so generated aliases never collide.
  const used = new Set<string>();
  const collectNames = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name)) used.add(node.name.text);
    if (ts.isInterfaceDeclaration(node) && ts.isIdentifier(node.name)) used.add(node.name.text);
    ts.forEachChild(node, collectNames);
  };
  collectNames(sf);

  const extractions: Extraction[] = [];

  const plan = (typeNode: ts.TypeLiteralNode, desiredName: string): void => {
    const host = hostStatement(typeNode);
    if (host === undefined) return; // no valid place to insert an alias — skip
    extractions.push({
      typeStart: typeNode.getStart(sf),
      typeEnd: typeNode.getEnd(),
      body: source.slice(typeNode.getStart(sf), typeNode.getEnd()),
      insertPos: host.getStart(sf),
      indent: indentOf(sf, host.getStart(sf)),
      desiredName,
    });
  };

  const visit = (node: ts.Node): void => {
    if (options.params && ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const obj = objectTypeOf(node.type);
      if (obj !== undefined) plan(obj, `${capitalize(node.name.text)}Param`);
    }
    if (options.returns && isSignatureLike(node)) {
      const obj = objectTypeOf(node.type);
      if (obj !== undefined) {
        const base = functionName(node);
        plan(obj, base !== undefined ? `${capitalize(base)}Return` : "FnReturn");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (extractions.length === 0) return { output: source, count: 0, changed: false };

  // Assign unique names in source order (stable, readable output).
  extractions.sort((a, b) => a.typeStart - b.typeStart);
  const edits: Edit[] = [];
  let seq = 0;
  for (const ex of extractions) {
    const name = uniqueName(ex.desiredName, used);
    used.add(name);
    // Replace the inline object type with the alias name...
    edits.push({ start: ex.typeStart, end: ex.typeEnd, text: name, seq: seq++ });
    // ...and insert the alias declaration before the host statement.
    edits.push({ start: ex.insertPos, end: ex.insertPos, text: `type ${name} = ${ex.body};\n${ex.indent}`, seq: seq++ });
  }

  return { output: applyEdits(source, edits), count: extractions.length, changed: true };
}

/** A function-like node that has a return-type slot we can extract from. */
function isSignatureLike(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  );
}

/** Pick the script kind so `.tsx` parses JSX and `.ts` doesn't. */
function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".mts") || fileName.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
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

// ---------------------------------------------------------------------------
// CLI runner (shared by both fixer scripts)
// ---------------------------------------------------------------------------

const TS_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage"]);

/** Expand file/dir arguments into a flat list of TypeScript files. */
function collectFiles(paths: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (p: string): void => {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      const base = p.split("/").pop() ?? "";
      if (SKIP_DIR.has(base)) return;
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else if (TS_EXT.test(p) && !p.endsWith(".d.ts")) files.push(p);
  };
  for (const p of paths) walk(p);
  return files;
}

/** Options passed to a fixer's CLI entry point. */
export interface CliConfig {
  /** Human name shown in usage/output ("object parameter types"). */
  label: string;
  /** Which extractions this CLI performs. */
  extract: ExtractOptions;
  /** Script basename for the usage line (e.g. "extract-object-param-types.ts"). */
  scriptName: string;
}

/**
 * Shared entry point for the fixer CLIs. Reads the file/dir arguments, applies
 * `transformSource`, and either writes the result (default) or, with `--check`,
 * reports which files would change and exits non-zero if any would — suitable
 * for CI. `--dry` prints the diff count without writing.
 */
export function runCli(argv: readonly string[], config: CliConfig): void {
  const args = [...argv];
  const check = args.includes("--check");
  const dry = args.includes("--dry");
  const positionals = args.filter((a) => !a.startsWith("--"));

  if (positionals.length === 0) {
    process.stderr.write(
      `Extract inline ${config.label} into named \`type\` aliases.\n\n` +
        `Usage: bun run ${config.scriptName} [--check] [--dry] <file-or-dir> [...]\n\n` +
        `  --check   Don't write; exit 1 if any file would change (for CI).\n` +
        `  --dry     Don't write; print what would change.\n`,
    );
    process.exit(2);
  }

  const files = collectFiles(positionals);
  let changedFiles = 0;
  let totalExtractions = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const { output, count, changed } = transformSource(file, source, config.extract);
    if (!changed) continue;
    changedFiles++;
    totalExtractions += count;
    if (check || dry) process.stdout.write(`${check ? "would change" : "dry"}: ${file} (${count} extracted)\n`);
    else {
      writeFileSync(file, output, "utf8");
      process.stdout.write(`fixed: ${file} (${count} extracted)\n`);
    }
  }

  const verb = check ? "would extract" : dry ? "would extract" : "extracted";
  process.stdout.write(`\n${verb} ${totalExtractions} inline ${config.label} across ${changedFiles}/${files.length} file(s).\n`);
  if (check && changedFiles > 0) process.exit(1);
}
