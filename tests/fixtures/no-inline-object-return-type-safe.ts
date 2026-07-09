// Already a named return type — nothing to extract.
type Result = { z: number };
function named(): Result {
	return { z: 1 };
}

// Primitive / reference return types — not inline object types.
function prim(): number {
	return 1;
}
function ref(): Result {
	return { z: 1 };
}

// No return type annotation at all.
function inferred() {
	return { z: 1 };
}

// Void / union return types are not object types.
function nothing(): void {}
