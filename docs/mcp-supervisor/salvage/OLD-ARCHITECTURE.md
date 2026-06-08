# `@platformos/platformos-mcp-supervisor` — architecture

This document describes the v1 architecture of the
`@platformos/platformos-mcp-supervisor` package: what each module does,
how they fit together, the boot sequence, and the request-time
orchestration inside the single shipped tool (`validate_code`).

For the rationale behind the package (why we forked, what we deferred,
mitigation strategies for the cut surface), see
[`docs/mcp-supervisor/decisions/001-package/README.md`](../../docs/mcp-supervisor/decisions/001-package/README.md).
For the migration backlog (25 phases, P1–P25), see
[`.backlog/milestones/m-0 - pos-supervisor-…-(v1-va.md`](../../../.backlog/milestones/m-0%20-%20pos-supervisor-%E2%86%92-platformos-tools-migration-%28v1-va.md).

---

## 1. One-paragraph summary

The supervisor is a single-tool MCP server. It speaks stdio JSON-RPC,
boots an in-process platformOS Language Server, hydrates three docset
indexes (filters / objects / tags) from
`@platformos/platformos-check-docs-updater`, registers `validate_code`
on an `McpServer` instance, and waits for tool calls. Each
`validate_code` call runs the input through a deterministic
linear pipeline (parse → lint → enrich → pipeline → validators →
structural-warnings → diff-aware → domain guide → fix-gen → cluster →
scorecard → bridge → stamp → force-disable → cleanup) and returns a
strict-typed `ValidateCodeResult`.

---

## 2. Process topology

```
┌──────────────┐      stdio       ┌──────────────────────────────────────┐
│ MCP client   │ ◀─── JSON-RPC ──▶│ platformos-mcp-supervisor (Node)     │
│ (Claude Code,│                  │                                      │
│  VSCode MCP, │                  │  ┌────────────────────────────────┐  │
│  custom)     │                  │  │ McpServer (SDK)                │  │
└──────────────┘                  │  │   - registerTool('validate_code') │
                                  │  │   - StdioServerTransport       │  │
                                  │  └────────┬───────────────────────┘  │
                                  │           │                          │
                                  │     ┌─────▼──────────┐               │
                                  │     │ validate_code  │               │
                                  │     │   handler      │               │
                                  │     └─────┬──────────┘               │
                                  │           │ (in-process)             │
                                  │  ┌────────▼────────────────────────┐ │
                                  │  │ PlatformOSLSPClient             │ │
                                  │  │ ┌──── PassThrough streams ────┐ │ │
                                  │  │ │ client ⇄ server in-process  │ │ │
                                  │  │ └─────────────────────────────┘ │ │
                                  │  │ @platformos/platformos-language-│ │
                                  │  │ server-node `startServer`       │ │
                                  │  └─────────────────────────────────┘ │
                                  └──────────────────────────────────────┘
```

- **No subprocesses.** The language server runs in the same Node
  process via a `PassThrough` stream pair and
  `createProtocolConnection`. The historical `pos-cli lsp` subprocess
  is gone.
- **No HTTP / dashboard / event bus.** stderr is the only operational
  log surface; stdout is reserved for JSON-RPC frames.
- **One tool.** `validate_code` is the only entry. The MCP SDK's
  `registerTool` validates input against the Zod shape before
  dispatching to the handler.

---

## 3. Package layout

```
packages/platformos-mcp-supervisor/
├── package.json
├── tsconfig.json              # rootDir: src; module: commonjs
├── tsconfig.build.json        # extends; excludes **/*.spec.ts
├── vitest.config.mts          # single-fork-isolate
├── README.md
├── ARCHITECTURE.md            # (this file)
├── scripts/
│   ├── copy-data.mjs          # postbuild: src/data → dist/data
│   ├── smoke-stdio.mjs        # real-bin verification via MCP SDK Client
│   └── record-parity.mjs      # capture pos-supervisor baselines
├── src/
│   ├── bin/
│   │   └── platformos-mcp-supervisor.ts   # CLI entrypoint (#!/usr/bin/env node)
│   ├── core/                              # pure logic
│   │   ├── constants.ts                   # timeouts, confidence defaults
│   │   ├── utils.ts                       # toUri / sanitizePath / toPosixPath
│   │   ├── tool-error.ts                  # ToolError class (typed status)
│   │   ├── logger.ts                      # createLogger (stderr only)
│   │   ├── domain-detector.ts             # getDomainFromPath
│   │   ├── position-utils.ts              # offsetToLineCol etc.
│   │   ├── liquid-parser.ts               # parse + extractAllFromAST
│   │   ├── lsp-client.ts                  # PlatformOSLSPClient (in-process)
│   │   ├── filters-index.ts               # FiltersIndex (docset wrapper)
│   │   ├── objects-index.ts               # ObjectsIndex
│   │   ├── tags-index.ts                  # TagsIndex
│   │   ├── hint-loader.ts                 # data/hints/*.md template engine
│   │   ├── knowledge-loader.ts            # data/* loader (gotchas, triggers, …)
│   │   ├── asset-index.ts                 # buildAssetIndex / resolveAssetPath
│   │   ├── translation-index.ts           # buildTranslationIndex
│   │   ├── page-route-index.ts            # buildPageRouteIndex + overlay
│   │   ├── project-scanner.ts             # scanProject → ProjectMap
│   │   ├── project-map.ts                 # TTL-cached getProjectMap
│   │   ├── project-fact-graph.ts          # ProjectFactGraph (graph queries)
│   │   ├── dependency-graph.ts            # resolveRender/Function/Graphql
│   │   ├── render-flow.ts                 # variable-flow analysis
│   │   ├── diagnostic-record.ts           # extractParams + templateOf
│   │   ├── diagnostic-pipeline.ts         # 15-step ORDERED post-processing
│   │   ├── structural-warnings.ts         # 16 detectors → pos-supervisor:* warnings
│   │   ├── error-enricher.ts              # enrichAll + bridgeRulesOntoUnattributed
│   │   ├── fix-generator.ts               # generateFixes / cluster / scorecard
│   │   ├── schema-validator.ts            # schema YAML structural checks
│   │   ├── translation-validator.ts       # translation YAML locale-wrapper check
│   │   ├── schema-property-checker.ts     # GraphQL ↔ schema cross-check
│   │   └── rules/
│   │       ├── engine.ts                  # Rule, runRules, force-disable
│   │       ├── queries.ts                 # graph-aware helpers
│   │       ├── module-paths.ts            # module installation queries
│   │       ├── index.ts                   # loadAllRules (registers 32 modules)
│   │       └── <Check>.ts × 32            # per-check rules (92 rules total)
│   ├── data/                              # verbatim from source (the only `cp`)
│   │   ├── hints/                         # one Markdown per LSP check
│   │   ├── knowledge.json                 # check summaries + gotchas + …
│   │   ├── checks/                        # per-check YAML metadata
│   │   ├── shopify-objects.json           # Shopify contamination data
│   │   ├── shopify-filters.json
│   │   ├── shopify-tags.json
│   │   ├── content-triggers.yml
│   │   ├── language-features.yml
│   │   ├── modules-missing-docs.json
│   │   ├── domain-gotchas.yml
│   │   └── references/                    # markdown docs (future tools)
│   ├── test/
│   │   └── index-stubs.ts                 # shared FiltersIndex/ObjectsIndex stubs
│   ├── tools/
│   │   └── validate-code.ts               # the orchestrator (~1010 LOC)
│   ├── server.ts                          # startServer({ projectDir, log? })
│   └── index.ts                           # public re-exports
└── test/
    ├── fixtures/
    │   ├── project/                       # 26 files — platformOS project tree
    │   ├── broken-project/                # 43 files — known-bad fixtures
    │   └── parity/
    │       ├── corpus.ts                  # 13 corpus entries
    │       └── <NN>-<slug>.expected.json  # 13 captured baselines
    ├── helpers/
    │   ├── server.ts                      # stdio test client (MCP SDK)
    │   └── server.spec.ts
    ├── integration/
    │   └── validate-code-features.spec.ts # 10 features through real stdio bin
    ├── parity/
    │   └── validate-code-parity.spec.ts   # 16 = 3 sanity + 13 deep-equal
    ├── upstream/
    │   └── lsp-diagnostic-contract.spec.ts# 23 pinned (check, msg) pairs
    └── POS_CLI_AUDIT.md                   # migration audit reference
```

Specs **colocate as `*.spec.ts` next to source under `src/`** (matches
`platformos-check-common/src/checks/*/index.spec.ts`). Integration,
parity, and upstream specs live under `test/` because they need
fixtures, helpers, or recorded baselines that don't belong next to
source.

---

## 4. Dependency graph

### External / workspace deps

| Dep | Role |
|---|---|
| `@modelcontextprotocol/sdk@^1.29.0` | `McpServer`, `StdioServerTransport`, MCP wire protocol |
| `@platformos/platformos-language-server-node@0.0.19` | `startServer(connection)` — the in-process LSP |
| `@platformos/platformos-check-common@0.0.19` | `PlatformOSDocset` interface, check types |
| `@platformos/platformos-check-docs-updater@0.0.19` | `PlatformOSLiquidDocsManager` (filters / objects / tags JSON) |
| `@platformos/liquid-html-parser@0.0.17` | Two-stage Liquid parser (CST → AST), `walk`, `NodeTypes`, `NamedTags` |
| `vscode-languageserver/node` + `vscode-languageserver-protocol/node` | LSP client/server runtime + typed protocol constants |
| `vscode-languageserver-textdocument` | Text document mutations |
| `js-yaml@^4.1.0` | Schema / translation YAML parsing |
| `normalize-path@^3.0.0` | Forward-slash path normalisation (per platformos-tools convention) |
| `zod@^3.23.8` | Tool input schema |

### Internal module dependencies

```
                              startServer
                                  │
       ┌──────────────────────────┼──────────────────────────────┐
       ▼                          ▼                              ▼
PlatformOSLiquidDocsManager   PlatformOSLSPClient          loadAllRules
       │                          │                              │
       ▼                          ▼                              ▼
FiltersIndex                  in-process LSP                 Rule registry
ObjectsIndex                  (PassThrough +                 (32 modules,
TagsIndex                      protocol conn)                 92 rules)
       │                          │                              │
       └──────────────────────────┼──────────────────────────────┘
                                  ▼
                         ValidateCodeContext
                                  │
                                  ▼
                   validate_code handler (1010 LOC)
                                  │
   ┌───────────────┬──────────────┼────────────────┬──────────────────┐
   ▼               ▼              ▼                ▼                  ▼
liquid-parser   lsp-client    error-enricher   diagnostic-       structural-
(walks AST,     (sync doc,    (rules first,    pipeline          warnings
extracts        await diags)  regex fallback)  (15 steps)        (16 detectors)
structural)
   │               │              │                │                  │
   └───────────────┴──────────────┼────────────────┴──────────────────┘
                                  ▼
                         schema-validator
                         translation-validator
                         schema-property-checker
                                  │
                                  ▼
                          fix-generator
                          (cluster + scorecard)
                                  │
                                  ▼
                          knowledge-loader
                          (domain guide + tips)
                                  │
                                  ▼
                          bridge → stamp → filter
                                  │
                                  ▼
                          ValidateCodeResult
```

---

## 5. Module reference

### 5.1 `src/server.ts` — `startServer(opts)`

**Public surface:** `startServer(opts: ServerOptions): Promise<ServerHandle>`.

**Boot sequence** (linear, fail-fast on `projectDir` missing):

1. `statSync(projectDir)` — abort with a clear error if the path is
   missing or not a directory.
2. `loadAllRules()` — idempotent registration of the 32 per-check rule
   modules against the engine.
3. `new PlatformOSLiquidDocsManager(log)` →
   `await docsManager.setup()` (best-effort HTTP fetch; falls back to
   the local cache if the fetch fails).
4. `Promise.allSettled` over three concurrent index loads:
   `FiltersIndex.load`, `ObjectsIndex.load`, `TagsIndex.load`. Failures
   are non-fatal — the supervisor degrades to no suggestions for that
   check kind.
5. `new PlatformOSLSPClient()` → `lsp.initialize(projectDir, …)` —
   handshake with the in-process LSP, capabilities negotiated, root URI
   advertised. The promise resolves whether init succeeds OR fails (the
   server should still respond to MCP calls, surfacing the LSP failure
   as an `info` diagnostic per request).
6. Build `ValidateCodeContext` carrying `{ directory, lsp, awaitLsp,
   filtersIndex, objectsIndex, tagsIndex, log }`.
7. `new McpServer({ name, version })` →
   `mcpServer.registerTool('validate_code', { description, inputSchema },
   handler)`.
8. `new StdioServerTransport()` → `await mcpServer.connect(transport)`.
9. Install `SIGINT` / `SIGTERM` handlers calling
   `shutdown(reason)` which (idempotently) closes the LSP +
   MCP server then `process.exit(0)`.

**Returned handle:** `{ lsp, mcpServer, context, shutdown }` — designed
so embedded consumers can drive the server programmatically without
spawning the bin.

### 5.2 `src/bin/platformos-mcp-supervisor.ts`

`#!/usr/bin/env node` CLI. Parses `--project <dir>` /
`--project=<dir>` / `--help` / `-h` / `POS_SUPERVISOR_PROJECT_DIR`
(CLI wins). Calls `startServer` and lets the SIGINT/SIGTERM handlers
own the lifetime. Compiles to `dist/bin/platformos-mcp-supervisor.js`
(matches `package.json#bin`); tsc preserves the shebang.

### 5.3 `src/core/logger.ts`

`createLogger(prefix?): (msg: string) => void`. Writes one
`<ISO-timestamp> [info]<prefix>: <message>\n` line to **stderr** per
call. stdout is reserved for the MCP JSON-RPC stream — anything written
there bricks the transport.

### 5.4 `src/core/lsp-client.ts` — `PlatformOSLSPClient`

In-process LSP client. The trick is the two `PassThrough` streams: the
in-monorepo `@platformos/platformos-language-server-node`'s
`startServer(connection)` expects a node `Connection` (reader/writer);
we wire one end of each PassThrough into the server and the other end
into a `createProtocolConnection`-built client. Typed
`ProtocolNotificationType` constants (e.g.
`PublishDiagnosticsNotification.type`) flow through cleanly because we
use `createProtocolConnection` from
`vscode-languageserver-protocol/node`, not the lower-level
`createMessageConnection` from `vscode-jsonrpc` (the latter rejects
typed protocol constants due to a private-field collision).

**Public methods:**

- `initialize(projectDir, { version? })` — handshake; idempotent.
  Sends `InitializeParams` with `initializationOptions: {
  'platformosCheck.includeFilesFromDisk': true }` so cross-file checks
  (`MissingPartial`, `MissingPage`) are warm during the handshake.
- `awaitDiagnostics(uri, content, timeoutMs)` — open / sync the
  document and wait for the next `publishDiagnostics` batch.
- `completions(uri, line, character)` — request completions.
- `hover(uri, line, character)` — request hover (used by `enrichAll`
  for `hover_docs`).
- `close()` — dispose transport state (no LSP shutdown handshake — see
  the file's comment block for why).

**Known caveat (documented):** `PlatformOSLiquidDocsManager.setup()`
issues an HTTP fetch that may outlive `close()`. Test code uses
`process.exit()` to short-circuit; the bin's SIGINT/SIGTERM handlers
let Node exit naturally after `close()`.

### 5.5 `src/core/filters-index.ts` / `objects-index.ts` / `tags-index.ts`

Each is a small class that loads from a `PlatformOSDocset` (filters /
objects / tags JSON), keyed by name. The destination wraps the docset's
public interface; the indexes are queried by `enrichAll` and
`generateFixes` for suggestions + Shopify contamination detection.

### 5.6 `src/core/liquid-parser.ts`

`parseLiquidFile(content): LiquidHtmlNode | null` — tolerant parse via
`toLiquidHtmlAST(content, { mode: 'tolerant', allowUnclosedDocumentNode:
true })`. Returns `null` on hard failure; the LSP lint step will still
surface the syntax error.

`extractAllFromAST(ast): ExtractedStructural` — walks the AST exactly
once, extracting `slug`, `layout`, `method`, render calls, GraphQL
refs, filters, tags, translation keys, prompts, doc params. Render
calls and GraphQL calls are deduped by name (first call wins; GraphQL
`source_kind` is upgraded to the most pessimistic value seen).

### 5.7 `src/core/diagnostic-record.ts`

Two exported helpers — `templateOf(check, message)` (masks identifiers
to produce a stable template string) and `extractParams(check,
message)` (per-check regex extractor with 16 specific extractors
covering `UnknownFilter`, `UndefinedObject`, `UnusedAssign`,
`MissingPartial`, `TranslationKeyExists`, `UnknownProperty`,
`DeprecatedTag`, `MissingRenderPartialArguments`, `MetadataParamsCheck`,
`GraphQLCheck`, `PartialCallArguments`, `GraphQLVariablesCheck`,
`UnusedDocParam`, `ValidFrontmatter`, `JsonLiteralQuoteStyle`,
`DuplicateFunctionArguments`).

### 5.8 `src/core/rules/`

**Rule engine** (`engine.ts`):

- `Rule { id, check, priority, when, apply }` — first-match-wins by
  priority within each check.
- `registerRule(rule)` / `registerRules(rules)` — append to the registry.
- `runRules(diag, facts)` — execute the engine.
- `forceDisable(idOrCheck)` / `releaseDisable(idOrCheck)` /
  `isCheckForceDisabled(name)` — manual operator surface (the only
  override mechanism that survives v1; analytics-driven auto-disable was
  dropped).
- `clearRules()` — resets registry AND force-disable set. Critical for
  test isolation.

**Rule modules** (`<Check>.ts` × 32):

Each module exports `export const rules: Rule[]`. The engine receives
the rule's `apply(facts)` return — `RuleResult { rule_id, hint_md,
fixes, confidence, see_also? }`. Rules can match on `check + message`
shape (priority resolution), and `facts.graph` (project fact graph) for
cross-file checks.

The 32 covered checks:

`ConvertIncludeToRender`, `DeprecatedTag`, `DuplicateFunctionArguments`,
`GraphQLCheck`, `GraphQLVariablesCheck`, `ImgLazyLoading`,
`ImgWidthAndHeight`, `InvalidLayout`, `JsonLiteralQuoteStyle`,
`LiquidHTMLSyntaxError`, `MetadataParamsCheck`, `MissingAsset`,
`MissingContentForLayout`, `MissingPage`, `MissingPartial`,
`MissingRenderPartialArguments`, `MissingSlug`, `NonGetRenderingPage`,
`OrphanedPartial`, `ParserBlockingScript`, `PartialCallArguments`,
`SchemaProperty`, `SchemaYAML`, `TranslationKeyExists`,
`TranslationMissingLocaleKey`, `UndefinedObject`, `UnknownFilter`,
`UnknownProperty`, `UnrecognizedRenderPartialArguments`, `UnusedAssign`,
`UnusedDocParam`, `ValidFrontmatter`.

92 distinct rules total (some checks have multiple priority-ordered
rule variants).

**Helpers** (`queries.ts`, `module-paths.ts`): graph-aware queries
(`nearestByLevenshtein`, `partialNames`, `partialsReachableFrom`,
`dependentsOf`, `translationKeysForLocale`, `stripLocalePrefix`,
`fileExists`, `assetNames`, `classifyPath`, `callerCount`, `isOrphan`,
`hasDocParams`, `classifyFileType`) and module installation lookups
(`moduleInstalled`, `installedModules`,
`moduleCallPathsByCategory`).

**Registry bootstrap** (`index.ts`): `loadAllRules()` is idempotent;
called by both `startServer` and `validate-code.ts` to guarantee rules
are registered before the first request.

### 5.9 `src/core/error-enricher.ts`

`enrichAll(diags, ctx)` — for each diagnostic:

1. Run the rule engine (first-match-wins). On a match, attach
   `rule_id`, `hint_md` (rendered template), `fixes` (rule-supplied),
   `confidence`, `see_also`.
2. Fallback regex enrichment per check (`UnknownFilter`,
   `UndefinedObject`, `GraphQLCheck`, `TranslationKeyExists`,
   `MissingPartial`, `UnknownProperty`, `DeprecatedTag`,
   `MissingRenderPartialArguments`, `MetadataParamsCheck`,
   `UnusedAssign`) — these produce the `suggestion` field and
   docset-aware "did you mean?" hints.
3. Hover-cache pass: dedupe hover requests by `(line, column)` to avoid
   thrashing the LSP.

`bridgeRulesOntoUnattributed(result, ctx)` — re-runs the rule engine
over diagnostics added AFTER `enrichAll` (structural warnings, schema /
translation / GraphQL validators, diff-aware checks). Attaches
`rule_id` / `hint_md` / `confidence` to late additions that would
otherwise stay unattributed.

### 5.10 `src/core/diagnostic-pipeline.ts` — 15-step ordered post-processing

**Ordering is load-bearing.** Each step has access to the mutable
`PipelineResult` (errors / warnings / infos) and may suppress or
downgrade entries. The pipeline supports a `_pipelineTrace` field
recording per-step `(errorsRemoved, warningsRemoved, errorsAfter,
warningsAfter)`.

| # | Step | Purpose |
|---|---|---|
| 0 | `applyUserSuppressions` | Project-level operator suppressions (config-driven) |
| 0a | `suppressLspKnownFalsePositives` | Known upstream LSP false positives (e.g. `assign x = a == b` syntax-not-supported) |
| 1 | `suppressDocParams` | `@param`-declared variables not flagged as undefined |
| 2 | `suppressUnusedDocParams` | `UnusedDocParam` when the param IS used (LSP cache lag) |
| 3 | `elevateShopify` | Promote Shopify contamination warnings to errors |
| 4 | `deduplicateArgChecks` | Collapse duplicate arg-related diagnostics |
| 5 | `suppressUndocumentedTargetParams` | `MetadataParamsCheck` for `modules/` callers (LSP can't see module internals) |
| 6 | `suppressRequiredParamsWithDefault` | `MissingRenderPartialArguments` when the partial has a `@default` |
| 7 | `suppressModuleHelpers` | Known-modules helper false positives |
| 8 | `suppressOrphanedPartial` | `OrphanedPartial` for `commands/` and `queries/` (called via `function`, not `render`) |
| 9 | `verifyMissingAssets` | Cross-check `MissingAsset` against disk; suppress + emit path hint |
| 10 | `verifyTranslationKeysOnDisk` | Cross-check `TranslationKeyExists` against `app/translations/*.yml` |
| 11 | `verifyPageRoutesOnDisk` | Cross-check `MissingPage` against `app/views/pages/`; in-memory overlay for the file under validation |
| 12 | `verifyOrphanedPartialOnDisk` | Cross-check `OrphanedPartial` against all render sites on disk |
| 13 | `verifyMissingPartialsOnDisk` | Cross-check `MissingPartial` (handles `commands/X` ↔ `app/lib/commands/X.liquid`) |
| 14 | `populateDefaultConfidence` | Stamp `confidence` + `rule_id = <check>.unmatched` for late-additions |

Plus the standalone `suppressUpstreamFrontmatterDup(result)` —
line-anchored deduplication of upstream `ValidFrontmatter` rows that
collide with our richer `pos-supervisor:InvalidLayout` /
`pos-supervisor:InvalidFrontMatter` structural checks. Called by
`validate-code.ts` between sections 2c and 2d.

### 5.11 `src/core/structural-warnings.ts` — 16 detectors

`generateStructuralWarnings(ast, content, absPath, structural,
existingChecks, options)` walks the AST per-detector and emits
`pos-supervisor:*` namespaced diagnostics. The 16 check kinds:

```
pos-supervisor:HtmlInPage
pos-supervisor:GraphqlInPartial
pos-supervisor:GraphqlMultilineInLiquidBlock
pos-supervisor:MissingReturn
pos-supervisor:MissingContentForLayout
pos-supervisor:MissingDocBlock
pos-supervisor:ShopifyObject
pos-supervisor:ShopifyTag
pos-supervisor:DeprecatedTag
pos-supervisor:InvalidSlug
pos-supervisor:InvalidLayout
pos-supervisor:InvalidMethod
pos-supervisor:NonGetRenderingPage
pos-supervisor:MissingSlug
pos-supervisor:InvalidFrontMatter
pos-supervisor:FilterArgMisuse
```

The `existingChecks` set lets the orchestrator deduplicate against the
LSP's own findings (e.g. don't re-emit `DeprecatedTag` for a tag the
LSP already flagged).

### 5.12 `src/core/fix-generator.ts`

`generateFixes(diagnostics, ast, content, filePath, ctx, projectDir)` —
heuristic fixes per check (18 per-check fix functions covering
`UndefinedObject`, `UnknownFilter`, `ConvertIncludeToRender`,
`DeprecatedTag`, `MissingPartial`, `MissingRenderPartialArguments`,
`NestedGraphQLQuery`, `TranslationKeyExists`,
`InvalidHashAssignTarget`, `MetadataParamsCheck`, `UnknownProperty`,
`LiquidHTMLSyntaxError`, plus 10 `pos-supervisor:*` structural fix
dispatchers).

The discriminated `Fix` union:

```ts
type Fix = TextEditFix | InsertFix | CreateFileFix | GuidanceFix | AddDocParamFix;
```

Special behaviour:

- `add_doc_param` fixes are coalesced via `mergeDocParamFixes` into one
  `insert` carrying every `resolves_params`.
- `MissingPartial` `lib/`-prefix forms emit `text_edit` (strip the
  prefix) instead of `create_file`.
- `text_edit` fixes get a `context: { before, after, line }` attached
  for dashboard display. **`insert` fixes do NOT** (this was the single
  parity divergence caught by P24 and reverted to source's narrower
  guard).

`clusterDiagnostics(errors, warnings)` — groups repeated check-name
diagnostics into clusters with a `unified_fix` description.

`generateScorecard(structural, domain, errors, warnings)` — produces
advisory architecture notes.

### 5.13 `src/tools/validate-code.ts` — the orchestrator (~1010 LOC)

Pipeline executed per request, in order:

```
1.   Parse (Liquid only)
2.   Lint — in-process LSP only (no pos-cli subprocess)
2a.  Diagnostic post-processing pipeline (the 15 steps)
2b.  Schema YAML structural validation (schema files only)
2b1. Translation YAML structural validation (translation files only)
2b2. Schema property cross-check (GraphQL files only)
2c.  Structural warnings (pos-supervisor:* intelligence)
2c1. Drop upstream ValidFrontmatter rows that collide on line
2d.  Diff-aware comparison (mode: full, file exists on disk)
2e.  New partial with @params — check existing callers
3.   Domain knowledge — triggered gotchas (mode: full)
4.   Generate proposed fixes (mode: full, has diagnostics)
5.   Content-triggered proactive tips (mode: full)
5b.  Scaffold-preventable error detection
6.   Error clustering (mode: full, ≥2 diagnostics)
7.   Architecture scorecard (mode: full, Liquid files)
8a.  Frontmatter-only page advisory
9.   Derive status (single source of truth)
9a.  must_fix_before_write boolean
10.  next_step prose generation
11.  Convert 0-based → 1-based line numbers
12a. Bridge rules onto unattributed diagnostics
12b. Re-stamp default confidence + rule_id
12b. Force-disable filter (drop check-name-disabled diagnostics)
12.  Null-hint cleanup
```

**BLOCKING_WARNINGS set** — drives the `must_fix_before_write` boolean.
Exactly 6 entries:

```
pos-supervisor:AddedParam       — new @param breaks existing callers
pos-supervisor:NewPartialParams — new partial declares params callers don't pass
pos-supervisor:RemovedRender    — removing render breaks user-visible behavior
pos-supervisor:RemovedGraphQL   — removing graphql call drops data fetch
pos-supervisor:RemovedParam     — removing @param breaks callers
OrphanedPartial                 — not reachable; shipping means orphaned file
```

**Mode behaviour:**

- `full`: every section runs.
- `quick`: skips sections 2d, 2e, 3, 4, 5, 5b, 6, 7 (no diff-aware, no
  new-partial callers, no domain guide, no fix gen, no content
  triggers / scaffold tips, no cluster, no scorecard).

---

## 6. Public surface

Re-exported from `src/index.ts`:

```ts
// Server
startServer, ServerOptions, ServerHandle

// Logger
createLogger, Logger

// LSP
PlatformOSLSPClient

// validate_code
validateCodeTool
ValidateCodeContext
ValidateCodeParams
ValidateCodeResult
ValidateCodeMode
ValidateCodeStatus
ValidateCodeDiagnostic
ValidateCodeStructuralSnapshot
ProposedFix
DomainGuide
DomainGuideGotcha
TipEntry
```

The bin (`platformos-mcp-supervisor`) is the user-facing surface;
`startServer` is the embedding surface; the typed result is the
agent-developer surface.

---

## 7. Test surface (19 spec files, 276 tests)

| Suite | Files | Tests | Purpose |
|---|---|---|---|
| Colocated unit (`src/**/*.spec.ts`) | 15 | 218 | Pure-function pins for every core module |
| Integration (`test/integration/`) | 1 | 10 | `validate_code` features through the real stdio bin |
| Upstream contract (`test/upstream/`) | 1 | 23 | LSP message-format pins (`(check, message_template)` pairs) |
| Parity (`test/parity/`) | 1 | 16 | Deep-equal corpus parity vs captured pos-supervisor baselines |
| Helper shape (`test/helpers/server.spec.ts`) | 1 | 6 | Stdio test-client invariants |
| **TOTAL** | **19** | **276** |  |

Test runtime: ~32s end-to-end (LSP boots are ~1s per integration `describe`).

---

## 8. Performance + caches

- **`project-map.ts`** wraps `scanProject` in a TTL cache
  (`PROJECT_MAP_CACHE_TTL_MS = 30s`). `validate_code` calls
  `getProjectMap` 3× per request (sections 2d, 2e, 12a); without the
  cache that would re-scan the project tree on every call.
- **Hover cache inside `enrichAll`** dedupes hover requests by
  `(line, column)` to avoid round-tripping the LSP for every variable
  reference on the same line.
- **`loadAllRules` is idempotent** — `startServer` and `validate-code`
  both call it; second + N-th calls are no-ops.
- **`knowledge-loader.ts`** lazy-loads `data/` files on first request,
  caches the parsed result in module-scoped variables. `_resetKnowledge`
  is exposed as a test seam.
- **No filesystem watcher.** Project-map staleness is bounded by the
  TTL; agents that need a fresh scan after a write call `validate_code`
  on the next iteration.

---

## 9. Configuration

| Source | Form | Purpose |
|---|---|---|
| `--project <dir>` / `--project=<dir>` | CLI | Project root |
| `POS_SUPERVISOR_PROJECT_DIR` | env | Project root (CLI wins) |
| `opts.log` | programmatic | Logger sink (defaults to `createLogger('platformos-mcp-supervisor')`) |
| `--help` / `-h` | CLI | Usage banner to stderr |

That's the entire configuration surface. There is no config file,
no operator overrides file, no engine-mode toggle. Future surfaces
should land as explicit `ServerOptions` fields, not implicit env vars.

---

## 10. v1 strips (explicit non-features)

Every drop below was a deliberate scope cut; the migration backlog
(`m-0`) carries per-task `finalSummary` notes recording the rationale.

| Surface | Why dropped |
|---|---|
| `pos-cli` subprocess fallback | Replaced by in-process LSP — eliminates PATH dependency |
| HTTP transport / `POST /call` | MCP stdio is the only consumer the package targets |
| fs-watcher | TTL cache is sufficient; add back if interactive iteration becomes load-bearing |
| Session event bus / NDJSON event log | Operator debugging via session NDJSON is not v1 scope |
| Blob store (content-hash storage) | Used only by analytics |
| Analytics store (SQLite + WAL) | Not v1 scope; rule engine ships static, calibration deferred |
| CAC predictor (config + rehydration + decisions) | Not v1 scope |
| Engine mode (adaptive vs static) | v1 is static-only; flag the day adaptive returns |
| Rule overrides loading (operator override file) | Manual `forceDisable()` API surface remains |
| Case-base rule scoring | Analytics-driven; not v1 scope |
| Promoted-rules init + watcher | Analytics-driven; not v1 scope |
| Dashboard | No HTTP transport, no operator UI in v1 |
| Project-map cache invalidation listener | TTL-based instead |
| MCP tools other than `validate_code` (9 dropped) | v1 ships `validate_code` only; the rest land as additive PRs |
| `pending_files` / `pending_pages` / `pending_translations` plumbing | Pending-state suppression depended on `validate_intent`; both deferred |
| `fingerprint` / `templateFingerprint` / `messageTemplate` / `makeDiagnosticRecord` | Analytics stamping; not v1 scope |
| `schemaIndex` (from `FixIndexes` + `EnrichContext`) | Zero in-scope consumers (P7 cascade) |

Mitigation strategies for each are documented in
[`docs/mcp-supervisor/decisions/001-package/README.md`](../../docs/mcp-supervisor/decisions/001-package/README.md).

---

## 11. Where to start reading

| Goal | Entry point |
|---|---|
| "How do I run it?" | `README.md` |
| "Why does it exist? What's deferred?" | `docs/mcp-supervisor/decisions/001-package/README.md` |
| "What does the orchestrator do per request?" | `src/tools/validate-code.ts` (top-of-file comment + section headers) |
| "How does the in-process LSP work?" | `src/core/lsp-client.ts` (top-of-file comment) |
| "What pipeline steps run and in what order?" | `src/core/diagnostic-pipeline.ts` (top-of-file ORDERING CONTRACT) |
| "What checks does it know about?" | `src/core/rules/` (32 modules) + `src/core/structural-warnings.ts` (16 detectors) |
| "How do I add a fix for a check?" | `src/core/fix-generator.ts` (`dispatchFix` switch) |
| "What does v1's output look like?" | `test/fixtures/parity/*.expected.json` (13 captured baselines) |
| "How do I extend the test surface?" | `test/POS_CLI_AUDIT.md` (migration audit) + `vitest.config.mts` |
