---
'@platformos/liquid-html-parser': patch
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
---

Add ReservedVariableName check: using a reserved Liquid literal (`true`, `false`, `nil`, `null`, `empty`, `blank`) as a variable name is now an error. Liquid resolves these names as built-in literals before variable lookup, so assignments to them can never be read back. Covers assign, capture, function, graphql, parse_json, hash_assign, for, tablerow, background, increment, decrement, and catch targets. UnusedAssign no longer reports these names to avoid a misleading "assigned but not used" message. The reserved-name set is derived from `LiquidLiteralValues`, now exported from `@platformos/liquid-html-parser`.
