---
'@platformos/platformos-mcp-supervisor': patch
---

Move to zod 4 (`^4.6.7`) and `@modelcontextprotocol/sdk` `^1.32.2`, which fixes
GHSA-mrhx-c7xc-m3w5 for every consumer: zod 3 has no patched release. The published
`validate_code` schema no longer claims `additionalProperties: false` — unknown keys were
always stripped rather than refused, and zod 4 converts that faithfully.
