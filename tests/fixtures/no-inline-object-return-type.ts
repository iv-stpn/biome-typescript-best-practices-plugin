function fn(): { test: string; age: number } {
	return { test: "a", age: 1 };
}

const arrow = (): { a: number } => ({ a: 1 });

async function gen<T>(x: T): { x: number } {
	return { x: 1 };
}

const fnExpr = function (): { e: number } {
	return { e: 1 };
};

function same(o: { a: number }): { a: number } {
	return o;
}
