/**
 * In-process platformOS LSP client.
 *
 * The pos-supervisor original (`src/core/lsp-client.js`) spawned `pos-cli lsp`
 * as a child process and talked JSON-RPC over its stdio. In this monorepo
 * we already own the language server (`@platformos/platformos-language-server-node`),
 * so the subprocess is replaced with an in-process driver: a pair of
 * `PassThrough` streams bridges a server-side `Connection`
 * (`vscode-languageserver/node`) to a client-side `MessageConnection`
 * (`vscode-jsonrpc/node`). Both sides speak vanilla LSP over the same
 * wire format the subprocess would have used; the bridge replaces only
 * the transport.
 *
 *      ┌────────── client (our PlatformOSLSPClient) ──────────┐
 *      │ initialize, didOpen, hover, completion …            │
 *      │   reader = StreamMessageReader(s2c)                 │
 *      │   writer = StreamMessageWriter(c2s)                 │
 *      └──────────────────┬──────────────────────────────────┘
 *                         │  c2s / s2c (PassThrough pair)
 *      ┌──────────────────┴──────────────────────────────────┐
 *      │ server (startServer from language-server-node)      │
 *      │   reader = StreamMessageReader(c2s)                 │
 *      │   writer = StreamMessageWriter(s2c)                 │
 *      │   publishDiagnostics ↑, request handlers ↑          │
 *      └─────────────────────────────────────────────────────┘
 *
 * The semantics of the original wrapper carry over unchanged:
 *   - `awaitDiagnostics` syncs the document, fires a hover-as-barrier,
 *     and resolves with the LAST `publishDiagnostics` batch after a
 *     `DIAGNOSTICS_SETTLE_MS` quiet window.
 *   - The version-tracked document cache lets the server treat repeated
 *     calls on the same URI as `didChange` instead of duplicate `didOpen`.
 *   - `normalizeLspDiagnostics` flattens the LSP `Diagnostic[]` into the
 *     pos-supervisor internal `{ check, severity, message, line, column,
 *     endLine, endColumn, _filePath }` shape; downstream enrichment and
 *     the diagnostic pipeline depend on that exact shape.
 */

import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { createConnection, type Connection } from 'vscode-languageserver/node';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import {
  CompletionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  type CompletionItem,
  type CompletionList,
  type Diagnostic,
  type Hover,
  type InitializeParams,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol';
import { createProtocolConnection, type ProtocolConnection } from 'vscode-languageserver-protocol/node';

import { path as commonPath } from '@platformos/platformos-check-common';
import { startServer as startLanguageServer } from '@platformos/platformos-language-server-node';

import {
  DIAGNOSTICS_SETTLE_MS,
  LSP_BARRIER_TIMEOUT_MS,
  LSP_DIAGNOSTICS_TIMEOUT_MS,
  LSP_READY_TIMEOUT_MS,
} from './constants';

// ── Public types ───────────────────────────────────────────────────────────

export type { Diagnostic as LspDiagnostic } from 'vscode-languageserver-protocol';

export type CompletionResult = CompletionItem[] | CompletionList | null;
export type HoverResult = Hover | null;

export type NormalizedSeverity = 'error' | 'warning' | 'info';

export interface NormalizedDiagnostic {
  check: string;
  severity: NormalizedSeverity;
  message: string;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  _filePath: string;
}

export interface NormalizedDiagnostics {
  errors: NormalizedDiagnostic[];
  warnings: NormalizedDiagnostic[];
  infos: NormalizedDiagnostic[];
  checks: Set<string>;
}

// ── Internal types ─────────────────────────────────────────────────────────

interface DiagnosticWaiter {
  resolve: (diags: Diagnostic[]) => void;
  mainTimer: NodeJS.Timeout;
  settleTimer: NodeJS.Timeout | null;
  latest: Diagnostic[] | null;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class PlatformOSLSPClient {
  private clientConn: ProtocolConnection | null = null;
  private clientToServer: PassThrough | null = null;
  private serverToClient: PassThrough | null = null;
  private serverConn: Connection | null = null;

  private readonly diagnosticsByUri = new Map<string, Diagnostic[]>();
  private readonly diagWaiters = new Map<string, DiagnosticWaiter>();
  private readonly openDocs = new Map<string, number>();
  private barrierId = 0;

  initialized = false;

  /**
   * Boot the in-process language server, connect the client, and complete
   * the LSP handshake. Idempotent: a second call against an already-initialised
   * client returns immediately.
   */
  async initialize(projectDir: string, opts: { version?: string } = {}): Promise<void> {
    if (this.initialized) return;
    if (!projectDir) throw new Error('PlatformOSLSPClient.initialize: projectDir is required');

    const c2s = new PassThrough();
    const s2c = new PassThrough();

    // Server: read client→server, write server→client.
    const serverConn = createConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
    // `startServer` from language-server-node calls `connection.listen()`
    // internally and wires up all request handlers + the platformOS docset.
    startLanguageServer(serverConn);

    // Client: read server→client, write client→server. `createProtocolConnection`
    // (not the lower-level `createMessageConnection`) is used so the typed
    // `ProtocolNotificationType` / `ProtocolRequestType` constants from the
    // protocol package are accepted natively. Mixing types across the two
    // packages (jsonrpc + protocol) triggers a private-field collision in
    // the message-type ancestry.
    const clientConn = createProtocolConnection(
      new StreamMessageReader(s2c),
      new StreamMessageWriter(c2s),
    );

    clientConn.onNotification(PublishDiagnosticsNotification.type, (params: PublishDiagnosticsParams) => {
      this.handlePublishDiagnostics(params);
    });

    // Silence transport errors after close; rejecting outstanding waiters
    // is the close() path's responsibility.
    clientConn.onError(() => {
      /* logged elsewhere if needed */
    });

    clientConn.listen();

    this.clientConn = clientConn;
    this.clientToServer = c2s;
    this.serverToClient = s2c;
    this.serverConn = serverConn;

    // Canonicalise via `vscode-uri` — the same form `vscode-uri`-based code
    // inside the language server uses. `pathToFileURL` alone produces a
    // mixed-case drive letter on Windows (`file:///D:/...`), but the LSP
    // server canonicalises to a lowercased drive letter internally; without
    // this round-trip the URI we wait on never matches the URI the server
    // publishes diagnostics for, and every cross-file diagnostic times out
    // silently on Windows.
    const rootUri = canonicalUri(pathToFileURL(projectDir).href);
    const initParams: InitializeParams = {
      processId: process.pid,
      clientInfo: { name: 'platformos-mcp-supervisor', version: opts.version ?? '0.0.0' },
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          completion: { completionItem: { snippetSupport: false } },
        },
        workspace: { workspaceFolders: true },
      },
      workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
      // platformOS LSP option: force `app/`-wide indexing during initialise
      // so cross-file checks (MissingPartial, MissingPage, etc.) are warm.
      initializationOptions: {
        'platformosCheck.includeFilesFromDisk': true,
      },
    };

    await this.race(
      clientConn.sendRequest(InitializeRequest.type, initParams),
      LSP_READY_TIMEOUT_MS,
      'initialize',
    );
    clientConn.sendNotification(InitializedNotification.type, {});
    this.initialized = true;
  }

  /**
   * Sync `content` into the document at `uri` and wait for the next
   * `publishDiagnostics` batch.
   *
   * The settle window: every incoming `publishDiagnostics` resets a
   * `DIAGNOSTICS_SETTLE_MS` timer; when the timer fires the latest batch
   * is returned. A hover request acts as a synchronisation barrier — the
   * server processes notifications in order, so a hover response proves
   * the server has seen our `didOpen` / `didChange`. The hard `timeoutMs`
   * bound resolves with whatever the latest batch is (or `[]` if none).
   */
  awaitDiagnostics(uri: string, content: string, timeoutMs: number = LSP_DIAGNOSTICS_TIMEOUT_MS): Promise<Diagnostic[]> {
    this.ensureClient();
    // Normalise once at the boundary. Every downstream Map key
    // (`diagnosticsByUri`, `diagWaiters`, `openDocs`) — and every URI the
    // server publishes diagnostics for — runs through the same
    // canonicaliser, so client + server keys agree on Windows.
    const key = canonicalUri(uri);
    this.syncDoc(key, content);
    this.diagnosticsByUri.delete(key);

    // Drop any pre-existing waiter for the same URI (shouldn't happen in
    // serialised use but guards against a stray timer leaking through).
    const existing = this.diagWaiters.get(key);
    if (existing) {
      clearTimeout(existing.mainTimer);
      if (existing.settleTimer) clearTimeout(existing.settleTimer);
      existing.resolve([]);
      this.diagWaiters.delete(key);
    }

    return new Promise<Diagnostic[]>((resolve) => {
      const waiter: DiagnosticWaiter = {
        latest: null,
        settleTimer: null,
        mainTimer: setTimeout(() => {
          this.diagWaiters.delete(key);
          if (waiter.settleTimer) clearTimeout(waiter.settleTimer);
          resolve(waiter.latest ?? []);
        }, timeoutMs),
        resolve: (diags) => {
          this.diagWaiters.delete(key);
          clearTimeout(waiter.mainTimer);
          if (waiter.settleTimer) clearTimeout(waiter.settleTimer);
          resolve(diags);
        },
      };
      this.diagWaiters.set(key, waiter);

      // Hover-as-barrier. The result is intentionally discarded — its only
      // purpose is to force the server to drain notifications first. Cap
      // separately at LSP_BARRIER_TIMEOUT_MS so a slow hover doesn't
      // dominate the diagnostic-wait window.
      const barrierTimeout = Math.min(timeoutMs, LSP_BARRIER_TIMEOUT_MS);
      this.barrierId++;
      void this.race(
        this.clientConn!.sendRequest(HoverRequest.type, {
          textDocument: { uri: key },
          position: { line: 0, character: 0 },
        }),
        barrierTimeout,
        'hover-barrier',
      ).catch(() => {
        /* barrier failures are tolerated — settle window covers the wait */
      });
    });
  }

  async completions(uri: string, line: number, character: number): Promise<CompletionResult> {
    this.ensureClient();
    return this.race(
      this.clientConn!.sendRequest(CompletionRequest.type, {
        textDocument: { uri: canonicalUri(uri) },
        position: { line, character },
      }),
      30_000,
      'completion',
    );
  }

  async hover(uri: string, line: number, character: number): Promise<HoverResult> {
    this.ensureClient();
    return this.race(
      this.clientConn!.sendRequest(HoverRequest.type, {
        textDocument: { uri: canonicalUri(uri) },
        position: { line, character },
      }),
      30_000,
      'hover',
    );
  }

  /**
   * Tear down the in-process server and dispose all transport state.
   * Subsequent method calls throw via `ensureClient`.
   *
   * The graceful `shutdown`/`exit` LSP handshake is intentionally skipped:
   * those exist so a SEPARATE process can flush state before terminating.
   * Here the server runs in our own process; disposing the connections
   * and destroying the underlying streams is the equivalent termination
   * step. Skipping the handshake also avoids the
   * `ERR_STREAM_WRITE_AFTER_END` race that the original close-with-exit
   * exposed (dispose queues a final write that hits the ended stream).
   *
   * KNOWN CAVEAT: `PlatformOSLiquidDocsManager` (constructed inside
   * `startLanguageServer` and outside our control) issues an HTTP
   * `latest.json` revision check on first use. That fetch holds an open
   * TCP socket that may outlive `close()`. The client's own state is
   * fully cleaned up — the lingering socket is a docs-manager
   * side-effect. Programmatic consumers that need a hard exit after
   * close should `process.exit()` explicitly; the production MCP server
   * (P19) doesn't care because its lifetime equals the process's.
   */
  async close(): Promise<void> {
    if (!this.clientConn) return;

    this.diagWaiters.forEach((w) => {
      clearTimeout(w.mainTimer);
      if (w.settleTimer) clearTimeout(w.settleTimer);
      w.resolve([]);
    });
    this.diagWaiters.clear();
    this.openDocs.clear();
    this.diagnosticsByUri.clear();

    // Mark uninitialised first so any racing write that surfaces an error
    // event after dispose finds an uninitialised client and short-circuits.
    this.initialized = false;

    const swallowError = () => {
      /* discard post-close stream errors */
    };
    this.clientToServer?.on('error', swallowError);
    this.serverToClient?.on('error', swallowError);

    try {
      this.clientConn.dispose();
    } catch {
      /* connection may already be disposed */
    }
    try {
      this.serverConn?.dispose();
    } catch {
      /* server connection may already be disposed */
    }
    // Force-close the duplex pair so the server-side reader's open file
    // handle is released and the event loop becomes drainable. The
    // connections above are disposed, so no further writes are attempted.
    this.clientToServer?.destroy();
    this.serverToClient?.destroy();

    this.clientConn = null;
    this.serverConn = null;
    this.clientToServer = null;
    this.serverToClient = null;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private syncDoc(uri: string, text: string): void {
    const conn = this.clientConn!;
    const langId = uri.endsWith('.graphql') ? 'graphql' : 'liquid';
    const prev = this.openDocs.get(uri);
    if (prev !== undefined) {
      const next = prev + 1;
      this.openDocs.set(uri, next);
      conn.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: next },
        contentChanges: [{ text }],
      });
    } else {
      this.openDocs.set(uri, 1);
      conn.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: langId, version: 1, text },
      });
    }
  }

  private handlePublishDiagnostics(params: PublishDiagnosticsParams): void {
    // The server's URI is the source of truth for the canonical form — every
    // map key on the client side is normalised through the same
    // `vscode-uri`-based helper, so client + server agree on Windows where
    // pathToFileURL would otherwise produce a mixed-case drive letter that
    // never matches what the LSP publishes.
    const uri = canonicalUri(params.uri);
    const diags = params.diagnostics ?? [];
    this.diagnosticsByUri.set(uri, diags);

    const waiter = this.diagWaiters.get(uri);
    if (!waiter) return;

    waiter.latest = diags;
    if (waiter.settleTimer) clearTimeout(waiter.settleTimer);
    waiter.settleTimer = setTimeout(() => {
      waiter.resolve(waiter.latest ?? diags);
    }, DIAGNOSTICS_SETTLE_MS);
  }

  private ensureClient(): void {
    if (!this.clientConn || !this.initialized) {
      throw new Error('PlatformOSLSPClient: initialize() has not been called');
    }
  }

  private async race<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`platformOS LSP timeout: ${label}`)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// ── URI canonicaliser ──────────────────────────────────────────────────────

/**
 * Round-trip a `file:` URI through `vscode-uri`'s `URI.parse(...).toString(true)`
 * so client-side Map keys and server-side `params.uri` agree byte-for-byte.
 *
 * Why this exists: on Windows, `pathToFileURL('D:\\a\\…').href` produces a
 * URI with an upper-case drive letter (`file:///D:/a/…`), but the in-process
 * language server canonicalises internally to a lower-case drive letter
 * (`file:///d:/a/…`). The client waits for diagnostics keyed by the
 * upper-case URI; the server publishes them keyed by the lower-case URI;
 * `Map.get(uri)` misses; `awaitDiagnostics` times out at
 * `LSP_DIAGNOSTICS_TIMEOUT_MS` with `latest: null`; every cross-file
 * diagnostic on Windows silently returns `[]`. Routing every URI we send
 * AND every URI we receive through the same canonicaliser closes the gap.
 *
 * On Linux this is effectively a no-op (URIs already canonical), so the
 * Linux parity baselines are preserved unchanged.
 *
 * Delegates to `path.normalize` from `@platformos/platformos-check-common`,
 * the same helper the language-server-common consumes. Treats unparseable
 * input as-is rather than throwing — the LSP handshake should still
 * progress and surface a clear failure downstream instead of crashing the
 * server boot.
 */
function canonicalUri(uri: string): string {
  if (typeof uri !== 'string' || uri.length === 0) return uri;
  try {
    return commonPath.normalize(uri);
  } catch {
    return uri;
  }
}

/**
 * Test seam — exposes `canonicalUri` for unit assertions without making it
 * part of the public surface. Underscore-prefixed to match the pattern used
 * elsewhere in this package (`_resetKnowledge`, `_resetProjectMapCache`).
 */
export function _canonicalUri(uri: string): string {
  return canonicalUri(uri);
}

// ── Diagnostic normaliser ──────────────────────────────────────────────────

/**
 * Convert an LSP `Diagnostic[]` into the pos-supervisor internal shape.
 *
 * The `check` field is the canonical platformOS check name; the LSP emits
 * it as `Diagnostic.code` (string or number) for platformOS rules. If
 * `code` is missing we fall back to `source` (e.g. `'LSP'`), matching the
 * source's defensive behaviour.
 */
export function normalizeLspDiagnostics(
  lspDiags: ReadonlyArray<Diagnostic>,
  filePath: string,
): NormalizedDiagnostics {
  const errors: NormalizedDiagnostic[] = [];
  const warnings: NormalizedDiagnostic[] = [];
  const infos: NormalizedDiagnostic[] = [];
  const checks = new Set<string>();

  for (const d of lspDiags) {
    const code = d.code;
    const check =
      typeof code === 'string' ? code : typeof code === 'number' ? String(code) : (d.source ?? 'LSP');

    const severity: NormalizedSeverity =
      d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info';

    const diagnostic: NormalizedDiagnostic = {
      check,
      severity,
      message: d.message,
      line: d.range?.start?.line ?? 0,
      column: d.range?.start?.character ?? 0,
      endLine: d.range?.end?.line ?? null,
      endColumn: d.range?.end?.character ?? null,
      _filePath: filePath,
    };
    checks.add(check);

    if (severity === 'error') errors.push(diagnostic);
    else if (severity === 'warning') warnings.push(diagnostic);
    else infos.push(diagnostic);
  }

  return { errors, warnings, infos, checks };
}
