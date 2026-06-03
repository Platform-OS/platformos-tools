/**
 * Shared test helper — spawns the supervisor's stdio bin and drives it with
 * the official MCP SDK client.
 *
 * v1 trim: source carried an HTTP `callTool(...)` path because pos-supervisor
 * exposed both HTTP and stdio transports. v1 is stdio-only, so this helper
 * connects directly to `dist/bin/platformos-mcp-supervisor.js` with
 * `StdioClientTransport` and unwraps the SDK's `content: [{ type: 'text',
 * text: '...' }]` envelope back into the tool's structured result.
 *
 * Usage:
 *
 *   import { startSupervisor, FIXTURE_PROJECT_DIR } from './helpers/server';
 *
 *   let s: SupervisorHandle;
 *   beforeAll(async () => { s = await startSupervisor(FIXTURE_PROJECT_DIR); });
 *   afterAll(async () => { await s.stop(); });
 *
 *   const result = await s.callTool('validate_code', {
 *     file_path: 'app/views/pages/index.html.liquid',
 *     content: '<p>...</p>',
 *   });
 *
 * `startSupervisor` expects `dist/bin/platformos-mcp-supervisor.js` to exist
 * — run `yarn workspace @platformos/platformos-mcp-supervisor build:ts`
 * once before any integration suite. Failing to build surfaces a clear
 * error from the helper rather than the SDK's opaque transport failure.
 */

import { existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import normalize from 'normalize-path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── Public types ───────────────────────────────────────────────────────────

export interface StartSupervisorOptions {
  /** Override the bin path. Defaults to `<package>/dist/bin/platformos-mcp-supervisor.js`. */
  binPath?: string;
  /** Environment overrides for the spawned child. */
  env?: Record<string, string>;
  /** Connection / handshake timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export interface SupervisorHandle {
  /** The wired-up SDK client. Use for low-level calls not exposed below. */
  client: Client;
  /**
   * Call a tool and return its structured result (NOT the SDK's content
   * envelope). The supervisor serialises every tool result via
   * `JSON.stringify` into a single text content block; this helper parses
   * that back so tests see the same shape the tool returns in-process.
   */
  callTool: <T = unknown>(name: string, args?: Record<string, unknown>) => Promise<T>;
  /** List the tools the server advertises. */
  listTools: () => Promise<Array<{ name: string; description?: string }>>;
  /** Tear down the client + child process. Idempotent. */
  stop: () => Promise<void>;
}

// ── Constants ──────────────────────────────────────────────────────────────

// The package compiles to CommonJS (tsconfig `module: commonjs`), so
// `__dirname` is defined at runtime. vitest transpiles `.ts` via esbuild
// in CJS mode for this package, so the same identifier resolves there.
//
// Every exported absolute path below is normalised with `normalize-path`
// so callers (helper specs, parity recorder, integration spec) see POSIX
// separators on every host. Without normalisation, Windows `path.resolve`
// produces `test\fixtures\project` and downstream `endsWith('test/fixtures/project')`
// assertions fail. `normalize-path` is safe here because these are
// filesystem paths (not URIs) — see the JSDoc warning on `toPosixPath` in
// `src/core/utils.ts`.
const PACKAGE_ROOT = normalize(resolve(__dirname, '..', '..'));

/** Absolute path to the bundled `project` fixture (read-only). POSIX separators. */
export const FIXTURE_PROJECT_DIR = normalize(resolve(PACKAGE_ROOT, 'test', 'fixtures', 'project'));

/** Absolute path to the bundled `broken-project` fixture (read-only). POSIX separators. */
export const FIXTURE_BROKEN_PROJECT_DIR = normalize(
  resolve(PACKAGE_ROOT, 'test', 'fixtures', 'broken-project'),
);

/** Default location of the compiled bin entry point. POSIX separators. */
export const DEFAULT_BIN_PATH = normalize(
  resolve(PACKAGE_ROOT, 'dist', 'bin', 'platformos-mcp-supervisor.js'),
);

// ── Public entry points ────────────────────────────────────────────────────

/**
 * Boot the supervisor against `projectDir` and return a handle with
 * tool-call helpers. The child process is spawned under Node and inherits
 * the current `PATH` so the in-process LSP can find its dependencies.
 */
export async function startSupervisor(
  projectDir: string,
  opts: StartSupervisorOptions = {},
): Promise<SupervisorHandle> {
  const binPath = opts.binPath ?? DEFAULT_BIN_PATH;
  if (!existsSync(binPath)) {
    throw new Error(
      `startSupervisor: bin not found at ${binPath}. Run \`yarn workspace @platformos/platformos-mcp-supervisor build:ts\` first.`,
    );
  }
  if (!existsSync(projectDir)) {
    throw new Error(`startSupervisor: projectDir does not exist: ${projectDir}`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath, '--project', projectDir],
    env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
  });

  const client = new Client({ name: 'platformos-mcp-supervisor-tests', version: '0.0.0' });

  const timeoutMs = opts.timeoutMs ?? 30_000;
  await withTimeout(client.connect(transport), timeoutMs, 'client.connect');

  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    try {
      await client.close();
    } catch {
      /* best-effort */
    }
  }

  async function listTools(): Promise<Array<{ name: string; description?: string }>> {
    const r = await client.listTools();
    return r.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  async function callTool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const r = await client.callTool({ name, arguments: args });
    // Locate the first text-content block and parse it. Tools serialise
    // their full result via `JSON.stringify` so the helper restores the
    // structured object the in-process tool returned. If the tool flagged
    // `isError`, surface it as a thrown Error so tests see the failure.
    const content = Array.isArray(r.content) ? r.content : [];
    const text = content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text;
    if (text == null) {
      throw new Error(`callTool(${name}): no text content in response`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`callTool(${name}): tool result was not valid JSON: ${(e as Error).message}`);
    }
    if (r.isError === true) {
      const msg =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `tool reported an error: ${text.slice(0, 200)}`;
      throw new Error(`callTool(${name}): ${msg}`);
    }
    return parsed as T;
  }

  return { client, callTool, listTools, stop };
}

/**
 * Materialise a writable copy of a fixture project so tests that mutate
 * files don't poison the read-only source tree. Returns the copy directory
 * plus a `cleanup()` to remove it.
 */
export function createTempProject(sourceDir: string): { dir: string; cleanup: () => void } {
  if (!existsSync(sourceDir)) {
    throw new Error(`createTempProject: sourceDir does not exist: ${sourceDir}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-test-'));
  cpSync(sourceDir, dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
