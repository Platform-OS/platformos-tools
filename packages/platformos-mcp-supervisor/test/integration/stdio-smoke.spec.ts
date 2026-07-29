/**
 * Smoke test: build the package, then drive the REAL stdio bin with the
 * official MCP SDK client. Verifies the transport, the `validate_code`
 * registration, the JSON-text result envelope, real linting end to end
 * (check-node → mapped diagnostics), AND the cross-file blast radius end to end
 * (the cached project graph → `dependentsOf` → `impact`).
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

  // A real project on disk so the cached graph (and thus blast radius) is real:
  // `home` renders `card` → `card` has one dependent; `lonely` has none.
  const writeProjectFile = (rel: string, body: string) => {
    const abs = join(projectDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  writeProjectFile('app/views/partials/card.liquid', '<div class="card">{{ title }}</div>');
  writeProjectFile('app/views/partials/lonely.liquid', '<div>nobody renders me</div>');
  writeProjectFile('app/views/pages/home.liquid', "{% render 'card' %}");
  writeProjectFile(
    'app/views/layouts/theme.liquid',
    '<html><body>{{ content_for_layout }}</body></html>',
  );
  writeProjectFile('app/lib/queries/list.liquid', "{% graphql r = 'noop' %}\n{% return r %}");

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, '--project', projectDir],
  });
  client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await client.connect(transport);
}, 180_000);

/**
 * Call `validate_code` and return the parsed result, polling until the
 * background-built project graph is fresh (so `impact` is deterministic rather
 * than the transient `computing`). Disk is not written between calls, so once
 * built the graph stays fresh.
 */
async function validateCode(args: { file_path: string; content: string; mode?: string }) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await client.callTool({ name: 'validate_code', arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toEqual('text');
    const result = JSON.parse(content[0].text);
    if (result.impact?.status !== 'computing') return result;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
  }
  throw new Error('blast radius did not settle (impact still "computing" after polling)');
}

afterAll(async () => {
  await client?.close();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe('Integration: validate_code over stdio', () => {
  // The always-empty envelope fields in this slice; spread into each expected
  // result so every assertion checks the WHOLE object.
  const EMPTY_ENVELOPE = {
    errors: [],
    warnings: [],
    infos: [],
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    parse_error: null,
    tips: [],
    domain_guide: null,
  };

  // "Computed, nothing depends on this" — the safe-to-change signal, and the
  // impact for files nothing on disk references.
  const NO_DEPENDENTS = {
    scope: 'direct',
    status: 'computed',
    dependents: { total: 0, by_kind: {}, sample: [] },
  };

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

  it('advertises exactly the validate_code tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['validate_code']);
  });

  it('returns the exact clean result for a valid layout (nothing depends on it)', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: NO_DEPENDENTS,
    });
  });

  it('surfaces the exact lint diagnostic AND the blast radius together, without conflating them', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_CONTENT_FOR_LAYOUT],
      impact: NO_DEPENDENTS,
    });
  });

  it('reports the cross-file blast radius: who depends on the edited partial', async () => {
    // `card` is rendered by the on-disk `home` page → exactly one dependent.
    const result = await validateCode({
      file_path: 'app/views/partials/card.liquid',
      content: '<div class="card">{{ title }} {{ subtitle }}</div>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: {
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { render: 1 },
          sample: ['app/views/pages/home.liquid'],
        },
      },
    });
  });

  it('reports zero dependents (safe to change) as computed — distinct from "not computed"', async () => {
    const result = await validateCode({
      file_path: 'app/views/partials/lonely.liquid',
      content: '<div>still nobody</div>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: NO_DEPENDENTS,
    });
  });

  it('flags a caller broken by the edited partial’s new {% doc %} signature (signature-impact)', async () => {
    // `home` renders `card` passing NO args. Give `card` a doc that REQUIRES
    // `title` → `home` is now missing a required param, reported cross-file.
    const result = await validateCode({
      file_path: 'app/views/partials/card.liquid',
      content: `{% doc %}
  @param {String} title - required title
{% enddoc %}
<div class="card">{{ title }}</div>`,
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: {
        scope: 'direct',
        status: 'computed',
        dependents: { total: 1, by_kind: { render: 1 }, sample: ['app/views/pages/home.liquid'] },
        signature_risk: [
          {
            caller: 'app/views/pages/home.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      },
    });
  });
});
