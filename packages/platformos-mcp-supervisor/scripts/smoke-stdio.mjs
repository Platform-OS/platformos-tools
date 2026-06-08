#!/usr/bin/env node
/**
 * Stand-alone smoke verification for the MCP stdio bin.
 *
 * Boots `dist/bin/platformos-mcp-supervisor.js` against a fresh tmp
 * project directory, then drives it with the official MCP SDK client:
 *
 *   1. `initialize` (handshake)
 *   2. `tools/list`              — expect exactly 1 tool: validate_code
 *   3. `tools/call validate_code` — expect a JSON body with
 *      `errors`, `warnings`, `infos`, `must_fix_before_write` keys.
 *
 * The script exits with code 0 on success and a non-zero code with a
 * diagnostic on failure. It is intentionally NOT a vitest spec — running
 * a real child process from inside vitest's worker pool flakes on busy
 * machines, and P24 owns the full integration coverage.
 *
 * Usage:
 *   yarn workspace @platformos/platformos-mcp-supervisor build:ts
 *   node packages/platformos-mcp-supervisor/scripts/smoke-stdio.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = resolve(__dirname, '..', 'dist', 'bin', 'platformos-mcp-supervisor.js');

if (!existsSync(BIN_PATH)) {
  console.error(`smoke: bin not built — run \`yarn build:ts\` first. Expected: ${BIN_PATH}`);
  process.exit(2);
}

const projectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-smoke-'));
console.error(`smoke: using project dir ${projectDir}`);

let exitCode = 0;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [BIN_PATH, '--project', projectDir],
});
const client = new Client({ name: 'smoke-client', version: '0.0.0' });

try {
  await client.connect(transport);
  console.error('smoke: connected ✓');

  // AC #3 — exactly one tool, named validate_code.
  const listed = await client.listTools();
  if (!Array.isArray(listed?.tools) || listed.tools.length !== 1) {
    throw new Error(`tools/list returned ${listed?.tools?.length ?? '?'} tools (expected 1)`);
  }
  if (listed.tools[0].name !== 'validate_code') {
    throw new Error(`tools/list[0].name = "${listed.tools[0].name}" (expected "validate_code")`);
  }
  console.error('smoke: tools/list → [validate_code] ✓');

  // AC #4 — tools/call validate_code returns the documented response shape.
  const called = await client.callTool({
    name: 'validate_code',
    arguments: {
      file_path: 'app/views/partials/example.liquid',
      content: '{% doc %}\n  Renders a static greeting.\n{% enddoc %}\nhello, world\n',
      mode: 'quick',
    },
  });
  const body = JSON.parse(called.content?.[0]?.text ?? '{}');
  const required = ['errors', 'warnings', 'infos', 'must_fix_before_write'];
  const missing = required.filter((k) => !Object.prototype.hasOwnProperty.call(body, k));
  if (missing.length > 0) {
    throw new Error(`tools/call validate_code missing keys: ${missing.join(', ')}`);
  }
  console.error('smoke: tools/call validate_code → keys present ✓');
  console.error('smoke: PASS');
} catch (e) {
  console.error(`smoke: FAIL — ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 1;
} finally {
  try {
    await client.close();
  } catch {
    /* best-effort */
  }
  rmSync(projectDir, { recursive: true, force: true });
}

process.exit(exitCode);
