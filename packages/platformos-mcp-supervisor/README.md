# `@platformos/platformos-mcp-supervisor`

An MCP server that validates platformOS code **before it is written**. It exposes one
tool, `validate_code`, over stdio.

An agent sends the buffer it is about to write; the server lints it in the context of the
real project and answers with the findings, the fixes the engine already computed, and a
single gate — `must_fix_before_write` — telling the agent whether writing the file would
produce something broken.

## Running it

```bash
platformos-mcp-supervisor --project /path/to/project
```

The project root may also come from `PLATFORMOS_PROJECT_DIR`. The process speaks MCP over
stdio and logs to **stderr only** — stdout is the protocol.

## The one tool

`validate_code` takes either a single buffer or a changeset:

```jsonc
{ "file_path": "app/views/pages/index.liquid", "content": "…" }
// or
{ "files": [ { "file_path": "…", "content": "…" }, … ] }
```

**Send a coordinated edit as one call.** Buffers in one request are overlaid on the
project together, so a partial being created alongside its caller resolves. Sent one at a
time, that same edit is reported broken.

The answer carries `status`, `must_fix_before_write`, the findings split into
`errors` / `warnings` / `infos`, the cross-file `impact` of the edit, and — when findings
were withheld to bound the response — `truncated`. `status: not_applicable` means the file
was **not checked**, which is neither approval nor refusal; `not_applicable_reason` says
why. See `src/result/types.ts` for the full contract and
`src/transport/instructions.ts` for what the server tells an agent about reading it.

## Request flow

```
input { file_path, content } | { files: [...] }
  → validate/  decline what needs no lint (outside root, wrong type, too big)   pure
  → lint/      ONE lintBuffers pass, every buffer overlaid at once               I/O
               → diagnostics + the engine's fixes/suggestions + the buffer's AST
  → enrich/    each check's documentation URL · docset signature where it helps  pure
  → result/    status · must_fix_before_write · next_step · impact               pure
  → response budget, applied LAST to finished results                            pure
  → ValidateCodeResult
```

The lint and impact run concurrently; the lint is the long pole and impact hides behind
it. Impact reports one thing — existing callers that the edited buffer's `{% doc %}`
contract breaks — and a buffer declaring no contract costs nothing, because the project is
not read at all. Where there is one, it reads the project's edge sources, keeps the few that
could name the edited file, and resolves their references through `platformos-graph`, so the
answer is fresh by construction rather than by revalidating a stored graph. It never answers
"who depends on this file": `{% render var %}` names its target at runtime, so that question
has no sound static answer and no count is published in place of one.

## What this package is not

It is a **leaf consumer** of the linting engine, and deliberately thin:

- **It detects nothing.** Every check lives in `platformos-check-common`, where the CLI,
  the editors and the browser build all get it too.
- **It authors no fixes.** `Offense.fix` / `suggest` are the engine's; this package only
  materialises them into edits against the buffer they were computed for.
- **It ships no documentation.** What it says about a filter, tag or object is read from
  `filters.json` / `tags.json` / `objects.json`; what it says about a check comes from that
  check's `meta.docs`. There is no `data/` directory and a guard fails the build if one
  appears. A gap in the docset is fixed upstream, in
  [platformos-documentation](https://documentation.platformos.com), never patched here.
- **It never speaks the LSP protocol.** Linting is a direct library call. (Pure helpers
  from the language-server package — the docset markdown renderer — are allowed under an
  allowlist; the protocol, a server and a transport are not.)

These are enforced, not aspirational: `test/guards/architecture-invariants.spec.ts` fails
the build on each. [`ARCHITECTURE.md`](./ARCHITECTURE.md) states them in full and explains
why each exists.

## Development

```bash
yarn workspace @platformos/platformos-mcp-supervisor build       # tsc -b
yarn workspace @platformos/platformos-mcp-supervisor type-check
yarn vitest run packages/platformos-mcp-supervisor               # unit + integration
```

The integration suite builds the package and drives the **real stdio bin** with the
official MCP SDK client, so the transport and the JSON envelope are covered end to end.
