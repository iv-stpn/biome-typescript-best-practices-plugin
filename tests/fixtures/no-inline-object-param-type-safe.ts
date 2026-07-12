// Already a named type alias — nothing to extract.
type Named = { z: number };
function already(n: Named) {
	return n.z;
}

// Primitive / reference param types — not inline object types.
function primitives(a: string, b: number, c: boolean) {
	return `${a}${b}${c}`;
}

// No type annotation at all.
function untyped(x) {
	return x;
}
