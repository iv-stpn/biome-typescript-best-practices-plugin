// Test harness for the typescript best-practices plugin.
//
// This plugin only reports diagnostics (no auto-fix), so each fixture is a pair:
//   tests/fixtures/<name>.ts            — the source to lint
//   tests/fixtures/<name>.expected.json — the diagnostics it should produce
//
// The expected file is a JSON array of { "line": <number>, "rule": "<slug>" }
// entries (order-independent), where <slug> is the part inside the
// `[ts/<slug>]` prefix of each diagnostic message. An empty array asserts
// the fixture is clean.
//
// For every fixture, copies the source into a temp file (so the test-only
// tests/biome.json applies, with only the plugin enabled), runs
// `biome lint --reporter=json`, and compares the extracted diagnostics.
//
// Run with: node scripts/run-tests.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TESTS = join(ROOT, "tests");
const FIXTURES = join(TESTS, "fixtures");
const TMP = join(TESTS, ".tmp");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");

const RULE_RE = /^\[ts\/([^\]]+)\]/;

const failures = [];
let count = 0;

mkdirSync(TMP, { recursive: true });

const cases = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -".ts".length))
  .sort();

// Normalize a diagnostic list into a stable, comparable string (sorted by
// line then rule) so comparison is order-independent.
/** @param {Array<{line: number, rule: string}>} list */
function normalize(list) {
  return [...list]
    .map((d) => `${d.line}:${d.rule}`)
    .sort()
    .join("\n");
}

for (const name of cases) {
  count++;
  const source = readFileSync(join(FIXTURES, `${name}.ts`), "utf8");
  const expected = JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), "utf8"));

  const tmpFile = join(TMP, `${name}.ts`);
  writeFileSync(tmpFile, source, "utf8");

  let raw = "";
  try {
    // Biome exits non-zero whenever any diagnostic is emitted; capture stdout
    // regardless and parse the JSON report from it.
    raw = execFileSync(BIOME, ["lint", "--reporter=json", tmpFile], {
      cwd: TESTS,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
  } catch (err) {
    raw = /** @type {{ stdout?: string }} */ (err).stdout ?? "";
  }

  /** @type {Array<{line: number, rule: string}>} */
  let actual = [];
  try {
    const report = JSON.parse(raw);
    actual = (report.diagnostics ?? [])
      .filter((/** @type {any} */ d) => d.category === "plugin")
      .map((/** @type {any} */ d) => {
        const m = RULE_RE.exec(d.message ?? "");
        return { line: d.location?.start?.line ?? 0, rule: m ? m[1] : "?" };
      });
  } catch {
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log("    could not parse biome JSON report:");
    for (const line of raw.split("\n")) console.log(`    | ${line}`);
    continue;
  }

  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    --- expected ---\n    ${e.split("\n").join("\n    ") || "(none)"}`);
    console.log(`    --- actual ---\n    ${a.split("\n").join("\n    ") || "(none)"}`);
  }
}

rmSync(TMP, { recursive: true, force: true });

console.log(
  `\n${failures.length === 0 ? "all passing" : `${failures.length} failing`}: ${count - failures.length}/${count} cases`,
);
process.exit(failures.length === 0 ? 0 : 1);
