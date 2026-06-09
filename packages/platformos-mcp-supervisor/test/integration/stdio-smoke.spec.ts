/**
 * Smoke test: build the package, then drive the REAL stdio bin with the
 * official MCP SDK client. Verifies the transport, the `validate_code`
 * registration, and the JSON-text result envelope end to end.
 *
 * The package is built in `beforeAll` (incremental `tsc -b`) so the suite is
 * self-contained under `yarn test` without a prior build step.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const TSC = resolve(REPO_ROOT, 'node_modules', '.bin', 'tsc');
const BIN = resolve(PACKAGE_ROOT, 'dist', 'bin', 'platformos-mcp-supervisor.js');

let client: Client;
let transport: StdioClientTransport;
let projectDir: string;

beforeAll(async () => {
  try {
    execFileSync(TSC, ['-b', resolve(PACKAGE_ROOT, 'tsconfig.build.json')], {
      cwd: PACKAGE_ROOT,
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `Failed to build the package for the smoke test:\n${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`,
    );
  }

  projectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-smoke-'));
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, '--project', projectDir],
  });
  client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await client.connect(transport);
}, 180_000);

afterAll(async () => {
  await client?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe('Integration: validate_code over stdio', () => {
  it('advertises exactly the validate_code tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['validate_code']);
  });

  it('returns a well-formed ValidateCodeResult from the stub handler', async () => {
    const res = await client.callTool({
      name: 'validate_code',
      arguments: { file_path: 'app/views/pages/index.liquid', content: '<p>hi</p>' },
    });

    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toEqual('text');

    const result = JSON.parse(content[0].text);
    expect(result.status).toEqual('ok');
    expect(typeof result.must_fix_before_write).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.infos)).toBe(true);
    expect(Array.isArray(result.proposed_fixes)).toBe(true);
  });
});
