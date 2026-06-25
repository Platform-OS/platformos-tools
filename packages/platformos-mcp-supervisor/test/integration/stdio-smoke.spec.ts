/**
 * Smoke test: build the package, then drive the REAL stdio bin with the
 * official MCP SDK client. Verifies the transport, the `validate_code`
 * registration, the JSON-text result envelope, AND that real linting flows
 * end to end (check-node → mapped diagnostics).
 *
 * The package is built in `beforeAll` (incremental `tsc -b`) so the suite is
 * self-contained under `yarn test` without a prior build step. A hermetic
 * `.platformos-check.yml` (one check enabled) keeps the diagnostics
 * deterministic and docset/network-free.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
// Run tsc through Node (not the `node_modules/.bin/tsc` shim): on Windows the
// shim is a `.cmd`, which `execFileSync` cannot launch by its extensionless
// path, so it would throw before producing any output. Invoking the JS entry
// with `process.execPath` works on every platform.
const TSC = resolve(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const BIN = resolve(PACKAGE_ROOT, 'dist', 'bin', 'platformos-mcp-supervisor.js');

let client: Client;
let transport: StdioClientTransport;
let projectDir: string;

beforeAll(async () => {
  try {
    execFileSync(process.execPath, [TSC, '-b', resolve(PACKAGE_ROOT, 'tsconfig.build.json')], {
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
  mkdirSync(join(projectDir, '.git'));
  // Hermetic config: enable only one check so the asserted diagnostics are deterministic.
  writeFileSync(
    join(projectDir, '.platformos-check.yml'),
    ['extends: platformos-check:nothing', 'MissingContentForLayout:', '  enabled: true', ''].join(
      '\n',
    ),
    'utf8',
  );

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, '--project', projectDir],
  });
  client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await client.connect(transport);
}, 180_000);

async function validateCode(args: { file_path: string; content: string; mode?: string }) {
  const res = await client.callTool({ name: 'validate_code', arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  expect(content[0].type).toEqual('text');
  return JSON.parse(content[0].text);
}

afterAll(async () => {
  await client?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe('Integration: validate_code over stdio', () => {
  it('advertises exactly the validate_code tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['validate_code']);
  });

  it('returns a clean, well-formed result for a valid layout', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>',
    });

    expect(result.status).toEqual('ok');
    expect(result.must_fix_before_write).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.infos).toEqual([]);
    expect(Array.isArray(result.proposed_fixes)).toBe(true);
  });

  it('surfaces a real lint diagnostic end to end', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(result.status).toEqual('error');
    expect(result.must_fix_before_write).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toEqual('MissingContentForLayout');
    expect(typeof result.errors[0].line).toBe('number');
    expect(typeof result.errors[0].column).toBe('number');
  });
});
