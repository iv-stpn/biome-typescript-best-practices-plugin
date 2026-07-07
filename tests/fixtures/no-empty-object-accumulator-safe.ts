const grouped = items.reduce((map, x) => map.set(x.k, x.v), new Map());
const sum = items.reduce((acc, x) => acc + x, 0);
const seeded = items.reduce((acc, x) => acc, { total: 0 });
