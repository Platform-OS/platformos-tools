/**
 * TASK-16, end to end: a background rejection must NOT kill the real server.
 *
 * The unit specs pin the handlers' behaviour; this pins the thing that actually
 * matters — that the process is still there afterwards and still answers
 * `validate_code`. That cannot be shown by driving a handler directly, because the
 * failure mode being prevented is Node terminating the process.
 *
 * The suite establishes both halves:
 *   1. a CONTROL proving that in this exact runtime an unhandled rejection really
 *      is fatal (otherwise the survival assertion below would pass vacuously on a
 *      Node version whose default is merely to warn);
 *   2. the real bin, made to reject in the background, still serving.
 *
 * Exercised against the BUILT `dist`, like the other integration specs.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const TSC = resolve(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const DIST_INDEX = resolve(PACKAGE_ROOT, 'dist', 'index.js');

let projectDir: string;
let wrapperPath: string;
let client: Client | undefined;
let transport: StdioClientTransport | undefined;

beforeAll(() => {
  try {
    execFileSync(process.execPath, [TSC, '-b', resolve(PACKAGE_ROOT, 'tsconfig.build.json')], {
      cwd: PACKAGE_ROOT,
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `Failed to build the package:\n${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`,
    );
  }

  projectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-guards-'));
  mkdirSync(join(projectDir, '.git'));
  writeFileSync(
    join(projectDir, '.platformos-check.yml'),
    ['extends: platformos-check:nothing', 'MissingContentForLayout:', '  enabled: true', ''].join(
      '\n',
    ),
    'utf8',
  );
  const write = (rel: string, body: string) => {
    const abs = join(projectDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  write('app/views/partials/card.liquid', '<div>{{ title }}</div>');
  write('app/views/pages/home.liquid', "{% render 'card' %}");

  // A wrapper that boots the real server and then rejects a promise with nobody
  // awaiting it — the exact shape that used to be fatal. It must never write to
  // stdout: that is the MCP JSON-RPC stream.
  wrapperPath = join(projectDir, 'reject-after-boot.mjs');
  writeFileSync(
    wrapperPath,
    [
      `import { startServer } from ${JSON.stringify(DIST_INDEX)};`,
      `await startServer({ projectDir: ${JSON.stringify(projectDir)} });`,
      `setTimeout(() => {`,
      `  Promise.reject(new Error('deliberate unawaited background rejection'));`,
      `}, 50);`,
      // Keep the wrapper's own error paths off stdout.
      `process.stderr.write('wrapper: server booted\\n');`,
      '',
    ].join('\n'),
    'utf8',
  );
}, 180_000);

afterAll(async () => {
  await client?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe('Integration: the server survives a background rejection', () => {
  it('CONTROL: an unhandled rejection is fatal in this runtime without a guard', () => {
    // Without this, the survival test below could pass on a Node whose default for
    // unhandled rejections is a warning — proving nothing.
    const control = spawnSync(
      process.execPath,
      [
        '-e',
        "Promise.reject(new Error('boom')); setTimeout(() => process.stdout.write('ALIVE'), 200);",
      ],
      { encoding: 'utf8' },
    );

    expect(control.status).not.toEqual(0);
    expect(control.stdout).not.toContain('ALIVE');
  });

  it('keeps serving validate_code after an unawaited rejection', async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [wrapperPath],
    });
    client = new Client({ name: 'guard-survival-client', version: '0.0.0' });
    await client.connect(transport);

    // Let the scheduled rejection fire. Under the control's behaviour the process
    // would be gone by now.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const res = await client.callTool({
      name: 'validate_code',
      arguments: {
        file_path: 'app/views/layouts/theme.liquid',
        content: '<html><body></body></html>',
      },
    });

    const content = res.content as Array<{ type: string; text: string }>;
    const result = JSON.parse(content[0].text);

    // Still a fully working tool: the real check still fires on the real project.
    expect(result.errors.map((e: { check: string }) => e.check)).toEqual([
      'MissingContentForLayout',
    ]);
    expect(result.status).toEqual('error');
  }, 120_000);

  it('answers a SECOND call, so the rejection did not leave it wedged', async () => {
    const res = await client!.callTool({
      name: 'validate_code',
      arguments: {
        file_path: 'app/views/layouts/theme.liquid',
        content: '<html><body>{{ content_for_layout }}</body></html>',
      },
    });

    const content = res.content as Array<{ type: string; text: string }>;
    const result = JSON.parse(content[0].text);

    expect([result.status, result.errors]).toEqual(['ok', []]);
  }, 120_000);
});
