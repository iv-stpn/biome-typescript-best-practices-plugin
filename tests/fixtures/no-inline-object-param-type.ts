function fn(obj: { test: string; age: number }) {
	return obj.test;
}

const arrow = (o: { a: number }) => o.a;

async function gen<T>(cfg: { x: number }, extra: T): Promise<number> {
	return cfg.x;
}

function twoParams(a: { p: number }, b: { q: string }) {
	return a.p + b.q.length;
}

function opt(o?: { maybe: boolean }) {
	return o;
}

const fnExpr = function (o: { e: number }) {
	return o.e;
};

// Destructured binding with inline object type — still an inline type, should be flagged.
function destructured({ a, b }: { a: number; b: string }) {
	return a + b.length;
}
