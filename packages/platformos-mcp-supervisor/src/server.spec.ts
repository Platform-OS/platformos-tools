/**
 * Boot-orchestration smoke tests for `startServer`.
 *
 * The heavyweight dependencies (in-process LSP, stdio transport, docset
 * HTTP fetch) are mocked so the test exercises the wiring without
 * hijacking process stdio or making a network call. Full end-to-end
 * boot-with-real-LSP coverage lands in P24.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Heavyweight dependency mocks ───────────────────────────────────────────
//
// Each mock uses a plain class — `new` semantics work without juggling
// `vi.fn().mockImplementation`'s prototype quirks. Per-test inspection
// hooks (registerToolSpy, fakeConnect, fakeClose) capture invocations
// against the shared module-level state.

const registerToolSpy = vi.fn((..._args: unknown[]): unknown => undefined);
const fakeConnect = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const fakeClose = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class FakeStdioTransport {}
  return { StdioServerTransport: FakeStdioTransport };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class FakeMcpServer {
    registerTool(...args: unknown[]) {
      return registerToolSpy(...args);
    }
    async connect(...args: unknown[]) {
      return fakeConnect(...args);
    }
    async close(...args: unknown[]) {
      return fakeClose(...args);
    }
  }
  return { McpServer: FakeMcpServer };
});

vi.mock('./core/lsp-client', () => {
  class FakeLsp {
    initialized = false;
    async initialize(_projectDir: string): Promise<void> {
      this.initialized = true;
    }
    async close(): Promise<void> {}
    async awaitDiagnostics(): Promise<unknown[]> {
      return [];
    }
    async completions(): Promise<null> {
      return null;
    }
    async hover(): Promise<null> {
      return null;
    }
  }
  return {
    PlatformOSLSPClient: FakeLsp,
    normalizeLspDiagnostics: () => ({ errors: [], warnings: [], infos: [], checks: new Set() }),
  };
});

vi.mock('@platformos/platformos-check-docs-updater', () => {
  class FakeDocsManager {
    async setup(): Promise<void> {}
    async filters(): Promise<unknown[]> {
      return [];
    }
    async objects(): Promise<unknown[]> {
      return [];
    }
    async tags(): Promise<unknown[]> {
      return [];
    }
  }
  return { PlatformOSLiquidDocsManager: FakeDocsManager };
});

// Import the unit under test AFTER mocks register.
import { startServer } from './server';

describe('startServer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-srv-'));
    registerToolSpy.mockClear();
    fakeConnect.mockClear();
    fakeClose.mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects when projectDir is missing', async () => {
    await expect(startServer({ projectDir: '' } as never)).rejects.toThrow(/projectDir is required/);
  });

  it('rejects when projectDir does not exist on disk', async () => {
    await expect(
      startServer({ projectDir: join(dir, 'does-not-exist'), log: () => {} }),
    ).rejects.toThrow(/projectDir does not exist or is not a directory/);
  });

  it('boots, registers exactly one tool, and connects the stdio transport (AC #2-3)', async () => {
    const lines: string[] = [];
    const handle = await startServer({ projectDir: dir, log: (m) => lines.push(m) });

    expect(handle.context.directory).toBe(dir);
    expect(registerToolSpy).toHaveBeenCalledTimes(1);
    expect(registerToolSpy.mock.calls[0][0]).toBe('validate_code');
    expect(fakeConnect).toHaveBeenCalledTimes(1);

    const joined = lines.join('\n');
    expect(joined).toMatch(/Starting platformos-mcp-supervisor v/);
    expect(joined).toMatch(/Registered 1 tool: validate_code/);
    expect(joined).toMatch(/MCP stdio transport connected/);

    await handle.shutdown('test');
  });

  it('shutdown is idempotent and closes the MCP server', async () => {
    const handle = await startServer({ projectDir: dir, log: () => {} });
    await handle.shutdown('test');
    await handle.shutdown('test-second-call');
    // mcpServer.close runs once because the second shutdown short-circuits.
    expect(fakeClose).toHaveBeenCalledTimes(1);
  });
});
