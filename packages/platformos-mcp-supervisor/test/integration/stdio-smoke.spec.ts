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

  // Real dependency targets so the `dependencies` field points at files that
  // actually exist in the project (the realistic agent scenario).
  const writeProjectFile = (rel: string, body: string) => {
    const abs = join(projectDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  writeProjectFile('app/views/partials/card.liquid', '<div class="card">{{ title }}</div>');
  writeProjectFile('app/views/layouts/theme.liquid', '<html><body>{{ content_for_layout }}</body></html>');
  writeProjectFile('app/lib/queries/list.liquid', "{% graphql r = 'noop' %}\n{% return r %}");

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

  // The always-empty envelope fields in this lint-only slice; spread into each
  // expected result so every assertion checks the WHOLE object.
  const EMPTY_ENVELOPE = {
    errors: [],
    warnings: [],
    infos: [],
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    dependencies: [],
    parse_error: null,
    tips: [],
    domain_guide: null,
    structural: null,
  };

  // The exact MissingContentForLayout error for a layout that omits
  // `{{ content_for_layout }}` (reported at index 0 → 1-based line/col 1).
  const MISSING_CONTENT_FOR_LAYOUT = {
    check: 'MissingContentForLayout',
    severity: 'error',
    message:
      "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 1,
  };

  it('returns the exact clean result for a valid layout (no dependencies)', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });
  });

  it('surfaces the exact lint diagnostic end to end', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_CONTENT_FOR_LAYOUT],
    });
  });

  it('reports the exact resolved dependency for a page that renders a partial', async () => {
    const result = await validateCode({
      file_path: 'app/views/pages/index.liquid',
      content: "{% render 'card' %}",
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      dependencies: [
        { kind: 'render', target: 'app/views/partials/card.liquid', line: 1, column: 1 },
      ],
    });
  });

  it('reports every dependency (layout + function + render) in source order', async () => {
    const result = await validateCode({
      file_path: 'app/views/pages/index.liquid',
      content: `---
layout: theme
---
{% function items = 'queries/list' %}
{% render 'card' %}`,
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      dependencies: [
        { kind: 'layout', target: 'app/views/layouts/theme.liquid', line: 1, column: 1 },
        { kind: 'function', target: 'app/lib/queries/list.liquid', line: 4, column: 1 },
        { kind: 'render', target: 'app/views/partials/card.liquid', line: 5, column: 1 },
      ],
    });
  });

  it('surfaces lint errors AND dependencies together without conflating them', async () => {
    // A layout that both omits content_for_layout (lint error) and renders a
    // partial (dependency) — the agent must see both, correctly separated.
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: "<body>{% render 'card' %}</body>",
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_CONTENT_FOR_LAYOUT],
      dependencies: [
        { kind: 'render', target: 'app/views/partials/card.liquid', line: 1, column: 7 },
      ],
    });
  });

  it('does not invent dependencies for dynamic (non-literal) targets', async () => {
    const result = await validateCode({
      file_path: 'app/views/pages/index.liquid',
      content: '{% assign name = "card" %}{% render name %}',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });
  });
});
