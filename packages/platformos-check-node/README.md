# `@platformos/platformos-check-node`

This is the Node.js wrapper of the runtime-agnostic [`@platformos/platformos-check-common`](https://npm.im/@platformos/platformos-check-common) package. It comes with batteries included.

See the [@platformos/platformos-check-common README](../platformos-check-common) for more details.

## Entrypoints

| Function | Use |
|---|---|
| `check(root, configPath?)` | Lint a whole project on disk; returns `Offense[]`. |
| `appCheckRun(root, configPath?, log?)` | Same, but also returns the resolved `App` and `Config`. |
| `checkAndAutofix(root, configPath?)` | Lint then apply safe autofixes to disk. |
| `lintBuffer(params)` | Lint a single in-memory buffer in the context of its on-disk project. |

### `lintBuffer` — lint one buffer with project overlay

`lintBuffer` is the typed seam an embedding tool (e.g. the MCP supervisor) lints
through — a **direct library call, not an LSP and not a subprocess**. It loads
the project from disk so cross-file checks (`MissingPartial`, `MissingPage`,
`OrphanedPartial`, …) resolve against real files, overlays the buffer under edit
in memory so the **unsaved** content is what gets linted and cross-referenced,
and returns the structured check-common `Offense[]` for that file with `fix` /
`suggest` and every typed field intact — no message-string round-trip.

```ts
import { lintBuffer } from '@platformos/platformos-check-node';

const offenses = await lintBuffer({
  root: '/abs/path/to/project',                 // project root (absolute)
  filePath: '/abs/path/to/project/app/views/pages/contact.liquid', // file under edit (absolute)
  content: editorBufferContents,                // unsaved buffer
  // configPath?: explicit config; resolved from root when omitted
});

for (const offense of offenses) {
  offense.check;     // e.g. 'MissingPartial'
  offense.severity;  // Severity
  offense.start.index; offense.end.index; // 0-based offsets
  offense.fix;       // optional Fixer (safe autofix)
  offense.suggest;   // optional Suggestion[] (manual fixes)
}
```

When `filePath` already exists in the project its on-disk source is replaced by
the buffer; when it is new (not yet saved) the buffer is added so it is still
linted. Only offenses for the buffer's file are returned.

## License

MIT.
