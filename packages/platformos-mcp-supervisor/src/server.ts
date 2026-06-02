/**
 * MCP supervisor server — stdio-only, single tool (`validate_code`).
 *
 * Boots the in-process LSP, hydrates the filter/object/tag indexes from
 * the platformOS docset, registers the `validate_code` tool against an
 * `McpServer`, and connects the stdio transport. Returns a handle the
 * caller (or the bin entrypoint) can use to drive shutdown.
 *
 * v1 strips (per TASK-19):
 *
 *   - **HTTP transport** — stdio is the only transport in v1.
 *   - **fs-watcher** — project map is cached with a TTL; freshness is good
 *     enough for v1's interactive use case. Re-add later if needed.
 *   - **session event bus** — no NDJSON event log.
 *   - **blob store** — no content-hash store.
 *   - **analytics store** — no SQLite metrics database.
 *   - **CAC config loading + rehydration** — predictor is gone (P18).
 *   - **engine mode** — there is no adaptive layer in v1.
 *   - **rule overrides loading** — no operator-driven force-enable /
 *     force-disable file. Operators that need this can use environment
 *     variables on a later milestone.
 *   - **case-base rule scoring** — no historical rule-score database.
 *   - **promoted-rules init + watcher** — no declarative-rule reloads.
 *   - **dashboard** — no HTTP UI surface.
 *   - **project map cache invalidation listener** — TTL handles staleness.
 *
 * The boot flow is intentionally linear and synchronous-looking: LSP
 * initialise → docset setup → indexes load → context build → tool
 * register → transport connect. Errors during docset / index hydration
 * are non-fatal (logged + ignored) because `validate_code` degrades
 * gracefully without them.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve as pathResolve, join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PlatformOSLiquidDocsManager } from '@platformos/platformos-check-docs-updater';

import { PlatformOSLSPClient } from './core/lsp-client';
import { FiltersIndex } from './core/filters-index';
import { ObjectsIndex } from './core/objects-index';
import { TagsIndex } from './core/tags-index';
import { loadAllRules } from './core/rules';
import { createLogger, type Logger } from './core/logger';
import { validateCodeTool, type ValidateCodeContext } from './tools/validate-code';

const SUPERVISOR_NAME = 'platformos-mcp-supervisor';

/**
 * Resolve the package version at runtime so we never desync with package.json.
 *
 * The package emits CommonJS (tsconfig `module: commonjs`), so `__dirname`
 * is always defined. When this module is loaded under vitest (`src/`) or
 * from `dist/`, the package root is one directory above either way.
 */
function readVersion(): string {
  try {
    const pkgPath = pathResolve(join(__dirname, '..', 'package.json'));
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readVersion();

// ── Public types ───────────────────────────────────────────────────────────

export interface ServerOptions {
  /** Absolute or relative path to the platformOS project root. Required. */
  projectDir: string;
  /** Logger sink. Defaults to a stderr logger tagged `supervisor`. */
  log?: Logger;
}

export interface ServerHandle {
  lsp: PlatformOSLSPClient;
  mcpServer: McpServer;
  context: ValidateCodeContext;
  /** Tear everything down and (when called from the bin) exit the process. */
  shutdown: (reason?: string) => Promise<void>;
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  if (!opts || typeof opts.projectDir !== 'string' || opts.projectDir.length === 0) {
    throw new Error('startServer: opts.projectDir is required');
  }

  const log = opts.log ?? createLogger(SUPERVISOR_NAME);
  const projectDir = pathResolve(opts.projectDir);

  // Fail fast if the project directory does not exist on disk. Without
  // this the LSP appears to initialise, then every subsequent call dies on
  // a missing file lookup — confusing because the error surfaces far from
  // the root cause.
  try {
    const stat = statSync(projectDir);
    if (!stat.isDirectory()) throw new Error(`${projectDir} is not a directory`);
  } catch (e) {
    throw new Error(
      `startServer: projectDir does not exist or is not a directory (${projectDir}): ${(e as Error).message}`,
    );
  }

  log(`Starting ${SUPERVISOR_NAME} v${VERSION} for ${projectDir}`);

  // ── Register every per-check rule module once ───────────────────────────
  // Idempotent. `validate_code` imports also call this, but doing it here
  // guarantees rules are loaded even if some future server-only tool is
  // added before `validate_code` is invoked.
  loadAllRules();

  // ── Hydrate the docset + indexes (best-effort, parallel) ────────────────
  //
  // `PlatformOSLiquidDocsManager.setup()` issues an HTTP fetch against
  // documentation.platformos.com to refresh the local docset cache. We
  // await it so the indexes see the freshest data, but failures are
  // non-fatal: `filters()` / `objects()` / `tags()` fall back to the
  // disk-cached or bundled JSON, and `validate_code`'s rules still work
  // without filter/object/tag metadata (suggestions and Shopify
  // contamination detection are best-effort).
  const docsManager = new PlatformOSLiquidDocsManager(log);
  try {
    await docsManager.setup();
  } catch (e) {
    log(`docset setup failed (non-fatal, will use bundled cache): ${(e as Error).message}`);
  }

  const filtersIndex = new FiltersIndex();
  const objectsIndex = new ObjectsIndex();
  const tagsIndex = new TagsIndex();

  await Promise.allSettled([
    filtersIndex
      .load(docsManager)
      .then(() => log(`filters index loaded (${filtersIndex.platformOSFilters().length} platformOS filters)`))
      .catch((e: Error) => log(`filters index failed: ${e.message}`)),
    objectsIndex
      .load(docsManager)
      .then(() => log('objects index loaded'))
      .catch((e: Error) => log(`objects index failed: ${e.message}`)),
    tagsIndex
      .load(docsManager)
      .then(() => log(`tags index loaded (${tagsIndex.platformOSTags().length} platformOS tags)`))
      .catch((e: Error) => log(`tags index failed: ${e.message}`)),
  ]);

  // ── Start the in-process LSP ────────────────────────────────────────────
  const lsp = new PlatformOSLSPClient();
  const lspStart = Date.now();
  let lspReadyResolve!: () => void;
  const lspReady = new Promise<void>((resolve) => {
    lspReadyResolve = resolve;
  });

  lsp
    .initialize(projectDir, { version: VERSION })
    .then(() => {
      log(`LSP ready (${Date.now() - lspStart} ms)`);
      lspReadyResolve();
    })
    .catch((e: Error) => {
      log(`LSP init failed (non-fatal — validate_code runs without diagnostics): ${e.message}`);
      // Still resolve so awaitLsp() never hangs forever.
      lspReadyResolve();
    });

  /**
   * Resolve once the LSP has finished its handshake (or failed). In v1
   * there's no separate warm-up phase — the LSP indexes the project
   * during the handshake via `includeFilesFromDisk: true`.
   */
  async function awaitLsp(): Promise<void> {
    if (lsp.initialized) return;
    await lspReady;
  }

  // ── Build validate_code context ─────────────────────────────────────────
  const context: ValidateCodeContext = {
    directory: projectDir,
    lsp,
    awaitLsp,
    filtersIndex,
    objectsIndex,
    tagsIndex,
    log,
  };

  // ── Wire up MCP stdio server ────────────────────────────────────────────
  const mcpServer = new McpServer({
    name: SUPERVISOR_NAME,
    version: VERSION,
  });

  const handler = validateCodeTool.createHandler(context);

  // Cast the SDK's `registerTool` to a loose function type at this call
  // site. The default generic inference walks the Zod shape into
  // `ShapeOutput<Args>` which projects each schema through `z.output`,
  // and our three-field shape (containing a `z.enum().optional()`)
  // tickles TS's "Type instantiation is excessively deep" limit. The
  // SDK validates arguments at runtime against `inputSchema` regardless
  // of the inferred type, so dropping the inference is purely a
  // compile-time concession.
  type LooseRegister = (
    name: string,
    config: { description?: string; inputSchema?: unknown },
    cb: (args: unknown) => Promise<unknown>,
  ) => unknown;
  const registerTool = mcpServer.registerTool.bind(mcpServer) as unknown as LooseRegister;

  registerTool(
    validateCodeTool.name,
    {
      description: validateCodeTool.description,
      inputSchema: validateCodeTool.inputSchema,
    },
    async (args) => {
      try {
        const result = await handler(args as Parameters<typeof handler>[0]);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: (e as Error).message }) }],
          isError: true,
        };
      }
    },
  );
  log(`Registered 1 tool: ${validateCodeTool.name}`);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  log('MCP stdio transport connected');

  // ── Graceful shutdown ───────────────────────────────────────────────────
  //
  // `lsp.close()` doesn't run the LSP shutdown/exit handshake — it
  // disposes streams directly (see the comment block above `close()` in
  // lsp-client.ts). The docs manager's HTTP fetch may already be in flight
  // and will outlive close(); that's documented and not fixable without
  // adding an abort signal to docs-updater.
  let shuttingDown = false;
  async function shutdown(reason = 'unknown'): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Shutting down (${reason})`);
    try {
      await lsp.close();
    } catch (e) {
      log(`LSP close failed: ${(e as Error).message}`);
    }
    try {
      await mcpServer.close();
    } catch (e) {
      log(`MCP server close failed: ${(e as Error).message}`);
    }
  }

  const sigintHandler = (): void => {
    void shutdown('SIGINT').then(() => process.exit(0));
  };
  const sigtermHandler = (): void => {
    void shutdown('SIGTERM').then(() => process.exit(0));
  };
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  return { lsp, mcpServer, context, shutdown };
}
