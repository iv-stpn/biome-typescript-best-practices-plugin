// Run `npx @biomejs/biome lint example.ts` to see the plugin flag each hazard.
// (Illustrative snippets; `obj`, `items`, `arr`, `Target` etc. are assumed in scope.)

// ts/no-as-cast — bypasses the type checker
const el = document.getElementById("x") as HTMLInputElement;
const wide = value as unknown as Target;

// ts/no-in-operator — walks the prototype chain
if ("id" in obj) {
}
for (const key in obj) {
}

// ts/no-empty-object-accumulator — {} accumulator leaks prototype keys
const grouped = items.reduce((acc, x) => {
  acc[x.key] = x.value;
  return acc;
}, {});

// ts/no-enum — emits runtime code, surprising semantics
enum Color {
  Red,
  Green,
}

// ts/no-dynamic-delete — deoptimises object shape
delete obj[key];

// ts/require-array-sort-compare — lexicographic sort of numbers
const sorted = [3, 20, 100].sort();

// --- safe forms below: the plugin leaves these alone ---
const literal = { role: "admin" } as const;
if (Object.hasOwn(obj, "id")) {
}
for (const k of Object.keys(obj)) {
}
const map = items.reduce((acc, x) => acc.set(x.key, x.value), new Map());
const Dir = { Up: "up", Down: "down" } as const;
delete obj.prop;
const ordered = [3, 20, 100].sort((a, b) => a - b);
