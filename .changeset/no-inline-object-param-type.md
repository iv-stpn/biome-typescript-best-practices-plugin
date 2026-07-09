---
"biome-typescript-best-practices-plugin": minor
---

Add `ts/no-inline-object-param-type`: flags an inline object type on a function parameter (`function fn(obj: { test: string })`) and, with an **unsafe** auto-fix, extracts it to a named `type` alias declared just before the enclosing statement (`type ObjParam = { test: string }; function fn(obj: ObjParam)`). Covers function declarations, arrow functions, and function expressions bound in a variable statement. This is the plugin's first rule that ships an auto-fix.
