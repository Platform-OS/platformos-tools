# `@platformos/platformos-mcp-supervisor`

A Model Context Protocol (MCP) server that exposes platformOS code
validation to LLM agents. Wraps `@platformos/platformos-language-server-node`
in-process and adds platformOS-specific structural checks, enrichment, fix
generation, and a project-aware diagnostic pipeline. The server speaks the
MCP stdio transport and registers a single tool: `validate_code`.

## Install

```sh
yarn add @platformos/platformos-mcp-supervisor
```

The package ships the bin `platformos-mcp-supervisor` (registered via
`package.json#bin`) plus a programmatic entry point at the package root.

## Usage — MCP stdio

Point any MCP-aware agent (Claude Code, opencode, VS Code MCP extensions,
custom clients via `@modelcontextprotocol/sdk`) at the bin:

```sh
platformos-mcp-supervisor
```

The bin picks up the project root via this precedence chain:

1. `--project <dir>` CLI argument
2. `POS_SUPERVISOR_PROJECT_DIR` environment variable
3. `process.cwd()` — the directory the MCP client spawned the bin from

Most MCP clients launch the server from the workspace root by
construction, so **no configuration is required** for the common case.
Example opencode entry:

```json
{
  "pos-supervisor": {
    "type": "local",
    "command": [
      "node",
      "/abs/path/to/platformos-mcp-supervisor/dist/bin/platformos-mcp-supervisor.js"
    ]
  }
}
```

Override only when the bin's cwd is unrelated to the project (system
service launches, multiplexed clients):

```sh
platformos-mcp-supervisor --project /path/to/platformos-project
# or
POS_SUPERVISOR_PROJECT_DIR=/path/to/platformos-project platformos-mcp-supervisor
```

`stdout` carries the JSON-RPC stream; `stderr` is reserved for log lines.

## Usage — programmatic

```ts
import { startServer } from '@platformos/platformos-mcp-supervisor';

const handle = await startServer({
  projectDir: '/path/to/platformos-project',
  // log defaults to a stderr logger tagged `platformos-mcp-supervisor`.
});

// handle.lsp        — PlatformOSLSPClient
// handle.mcpServer  — McpServer
// handle.context    — ValidateCodeContext (filtersIndex, objectsIndex, …)
// handle.shutdown   — async (reason?: string) => void  (idempotent)
```

The `shutdown` handler is also wired to `SIGINT` / `SIGTERM` so a
foreground process exits cleanly when the agent disconnects.

### The `validate_code` tool

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'my-agent', version: '0.1.0' });
await client.connect(new StdioClientTransport({
  command: 'platformos-mcp-supervisor',
  args: ['--project', '/path/to/project'],
}));

const result = await client.callTool({
  name: 'validate_code',
  arguments: {
    file_path: 'app/views/pages/index.html.liquid',
    content: '---\nslug: home\n---\n<p>Hello</p>',
    mode: 'full',  // or 'quick'
  },
});
```

The tool result content carries a JSON-stringified `ValidateCodeResult`:

```ts
interface ValidateCodeResult {
  status: 'ok' | 'warning' | 'error';
  must_fix_before_write?: boolean;
  errors: ValidateCodeDiagnostic[];
  warnings: ValidateCodeDiagnostic[];
  infos: ValidateCodeDiagnostic[];
  proposed_fixes: ProposedFix[];
  clusters: DiagnosticCluster[];
  scorecard: ScorecardNote[];
  tips: TipEntry[];
  domain_guide: DomainGuide | null;
  structural: ValidateCodeStructuralSnapshot | null;
  parse_error?: string;
  next_step?: string;
}
```

The full interface set is exported from the package root.

## Modes

- `full` (default): parser → in-process LSP lint → enrichment → diagnostic
  pipeline → schema/translation/GraphQL validators → structural warnings →
  diff-aware checks → domain knowledge → fix generation → cluster +
  scorecard → bridge rules → stamp defaults → force-disable filter.
- `quick`: skips fix generation, clustering, scorecard, domain guide,
  diff-aware, and the new-partial caller check. Used for rapid
  re-validation after applying fixes.

## Scope

### In scope (v1)

- `validate_code` MCP tool over stdio.
- In-process LSP via `@platformos/platformos-language-server-node`. **No
  `pos-cli` subprocess.**
- Structural warnings, schema / translation / GraphQL validators, fix
  generator, cluster / scorecard, domain guide, diagnostic pipeline,
  rule engine + library.
- Project scanner + fact graph for cross-file checks.

### Deferred (NOT in v1)

- Other MCP tools: `validate_intent`, `scaffold`, `project_map`,
  `analyze_project`, `lookup`, `domain_guide` (tool), `module_info`,
  `enrich_error`, `server_status`, `load_development_guide`.
- HTTP transport, dashboard, fs-watcher, session event bus, blob store,
  analytics store, CAC predictor, engine-mode (adaptive vs static), case
  base, promoted rules, rule overrides.
- Pending-state suppression (`pending_files` / `pending_pages` /
  `pending_translations`).

See [the migration plan
milestone](../../../.backlog/milestones/m-0%20-%20pos-supervisor-%E2%86%92-platformos-tools-migration-%28v1-va.md)
for the full scope rationale, and the [ADR for the package
decision](../../docs/mcp-supervisor/decisions/001-package/README.md) for
the architectural background.

## Development

```sh
yarn build:ts                  # tsc -b + copy data
yarn type-check                # tsc --noEmit
yarn test                      # vitest (single-fork isolate)
node scripts/smoke-stdio.mjs   # real-bin stdio smoke (requires build)
node scripts/record-parity.mjs # re-capture the source baseline (rare)
```

Layout:

```
src/
  bin/        — CLI entrypoint (compiles to dist/bin/)
  core/       — pure logic (parser, enricher, pipeline, rules, …)
  data/       — hints + knowledge base (copied verbatim into dist/)
  test/       — shared test stubs (in src/ so type-check covers them)
  tools/      — validate_code orchestrator
  server.ts   — startServer
  index.ts    — public re-exports
test/
  fixtures/   — platformOS project fixtures (project, broken-project, parity)
  helpers/    — stdio test client (MCP SDK Client + StdioClientTransport)
  integration/, parity/, upstream/ — non-colocated specs
```

Specs colocate as `*.spec.ts` next to source under `src/`; integration,
parity, and upstream contract specs live under `test/`.

## License

MIT.
