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
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { path as pathUtils } from '@platformos/platformos-check-common';

import { defaultGraphCachePath } from '../../src/graph-cache/graph-cache.js';
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
async function validateCodeWith(
  withClient: Client,
  args: { file_path: string; content: string; mode?: string },
) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = await withClient.callTool({ name: 'validate_code', arguments: args });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toEqual('text');
    const result = JSON.parse(content[0].text);
    if (result.impact?.status !== 'computing') return result;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
  }
  throw new Error('blast radius did not settle (impact still "computing" after polling)');
}

const validateCode = (args: { file_path: string; content: string; mode?: string }) =>
  validateCodeWith(client, args);

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
    // ONE tool. A second, similarly-named tool would force the agent to choose
    // between `validate_code` and `validate_files` with nothing in either name to
    // guide it; the multi-file case is the same tool with a `files` argument.
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

  /**
   * `mode` was a real input once and agents may still send it. The SDK validates
   * against the shape and drops what is not in it, so an old call still works — which
   * is the only reason removing the parameter is safe.
   */
  it('ignores a retired argument instead of rejecting the call', async () => {
    const args = {
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    };

    expect(await validateCode({ ...args, mode: 'full' })).toEqual(await validateCode(args));
  });

  const DIRECTORY_STRUCTURE =
    'Directory structure: https://documentation.platformos.com/developer-guide/platformos-workflow/directory-structure';

  /**
   * "Not checked" is a STATUS, not a sentence buried in prose.
   *
   * These two cases previously came back `status: 'ok'` with the explanation in
   * `next_step`, because the contract had nowhere else to put it — a stopgap this code
   * said so at the time. `not_applicable` plus a machine-readable
   * `not_applicable_reason` is that missing place: an agent branches on the reason
   * without parsing English, and `ok` goes back to meaning what it claims, "checked and
   * nothing objected". Reporting an unchecked file as `ok` is the exact false approval a
   * write gate must never produce.
   *
   * `impact` is `not_applicable` too, for the same underlying reason, so its zeroed
   * `dependents` can never be misread as a measured "nothing depends on this".
   *
   * The messages are asserted as whole literal strings rather than by calling the
   * factories that build them. This is the outermost test there is — a real server over
   * a real stdio pipe — and importing the implementation's wording would make it agree
   * with itself by construction.
   */
  const NOT_APPLICABLE_IMPACT = {
    scope: 'direct',
    status: 'not_applicable',
    dependents: { total: 0, by_kind: {}, sample: [] },
  };

  it('tells the agent a misplaced source was not checked, instead of reporting it clean', async () => {
    const result = await validateCode({
      file_path: 'scripts/helper.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'not_applicable',
      not_applicable_reason: 'misplaced_source',
      // NOT blocked. The file is very likely a mistake, but "likely" is a guess about
      // intent — a fixture or generator template lives here legitimately — and a gate
      // that vetoes legitimate work on a guess gets switched off.
      must_fix_before_write: false,
      impact: NOT_APPLICABLE_IMPACT,
      next_step:
        '`scripts/helper.liquid` is a platformOS source file outside every subtree the ' +
        'platform deploys (app/, marketplace_builder/, modules/*/public/, ' +
        'modules/*/private/). Nothing checked it, and nothing will load it either — a ' +
        'partial, page or query here is dead code. Move it under one of those directories ' +
        'unless it is deliberately a fixture or a build input. This is neither a pass nor ' +
        `a block. ${DIRECTORY_STRUCTURE}`,
    });
  });

  /**
   * A file that is not a platformOS source is usually not meant to be one, so it gets
   * the directory rule and a link rather than "move it under app/".
   *
   * THE CONTROL FOR THE CASE ABOVE, and the reason the two reasons are separate codes at
   * all: same status, same non-blocking verdict, opposite advice. A single collapsed
   * "unsupported type" answer would tell the author of `scripts/helper.liquid` nothing,
   * and telling the author of a `.jsx` component to move it under `app/` would be worse
   * than telling them nothing.
   */
  it('does not tell the agent to move a file that was never meant to be platformOS code', async () => {
    const result = await validateCode({
      file_path: 'src/components/Widget.jsx',
      content: 'export const Widget = () => null;\n',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'not_applicable',
      not_applicable_reason: 'unsupported_type',
      must_fix_before_write: false,
      impact: NOT_APPLICABLE_IMPACT,
      next_step:
        '`src/components/Widget.jsx` is not a platformOS source file, so there is nothing ' +
        'to check. The platform deploys app/, marketplace_builder/, modules/*/public/, ' +
        'modules/*/private/ only. Nothing was checked — writing this file is your call, ' +
        `not a validated pass. ${DIRECTORY_STRUCTURE}`,
    });
  });
});

/**
 * The loop an agent actually runs: `validate_code` reports a problem, the agent
 * fixes it on disk, `validate_code` is asked again — and must no longer report it.
 *
 * This is the end-to-end guarantee behind the caches on the request path (the
 * parsed-project `AppCache` and the project `GraphCache`): they are keyed on a
 * per-file fingerprint, so a file appearing, changing, or disappearing is picked
 * up on the NEXT call with no cache-clearing step. A regression here would be
 * invisible to unit tests of either cache — the tool would simply keep reporting a
 * problem the agent already fixed, or stop reporting one it re-introduced.
 *
 * Deliberately isolated: its own project dir, its own config (only `MissingPartial`
 * enabled) and its own server process, because unlike the suite above it WRITES to
 * disk between calls.
 */
describe('Integration: validate_code sees on-disk fixes without a cache-clearing step', () => {
  let fixClient: Client;
  let fixTransport: StdioClientTransport;
  let fixProjectDir: string;
  let partialPath: string;

  /** A page that renders `ghost`; only ever sent as a buffer, never written to disk. */
  const CALLER = {
    file_path: 'app/views/pages/ghost-caller.liquid',
    content: "{% render 'ghost' %}",
  };

  const MISSING_GHOST = {
    check: 'MissingPartial',
    severity: 'error',
    message: "'ghost' does not exist",
    line: 1,
    column: 11,
    end_line: 1,
    end_column: 18,
  };

  const EMPTY_ENVELOPE = {
    errors: [],
    warnings: [],
    infos: [],
    impact: {
      scope: 'direct',
      status: 'computed',
      dependents: { total: 0, by_kind: {}, sample: [] },
    },
  };

  beforeAll(async () => {
    fixProjectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-invalidation-'));
    mkdirSync(join(fixProjectDir, '.git'));
    writeFileSync(
      join(fixProjectDir, '.platformos-check.yml'),
      ['extends: platformos-check:nothing', 'MissingPartial:', '  enabled: true', ''].join('\n'),
      'utf8',
    );
    partialPath = join(fixProjectDir, 'app', 'views', 'partials', 'ghost.liquid');
    mkdirSync(dirname(partialPath), { recursive: true });

    fixTransport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--project', fixProjectDir],
    });
    fixClient = new Client({ name: 'invalidation-client', version: '0.0.0' });
    await fixClient.connect(fixTransport);
  }, 180_000);

  afterAll(async () => {
    await fixClient?.close();
    if (fixProjectDir) rmSync(fixProjectDir, { recursive: true, force: true });
  });

  it('reports the missing partial, clears it once created, and reports it again once removed', async () => {
    expect(await validateCodeWith(fixClient, CALLER)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_GHOST],
    });

    // The fix an agent would apply, in the SAME server process.
    writeFileSync(partialPath, '<div>ghost</div>', 'utf8');

    expect(await validateCodeWith(fixClient, CALLER)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });

    // Editing the now-existing partial keeps it resolved (the cached parse is
    // replaced, not discarded-and-forgotten).
    writeFileSync(partialPath, '<div>ghost, edited</div>', 'utf8');

    expect(await validateCodeWith(fixClient, CALLER)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });

    // And removing it brings the diagnostic back, so the cache is not merely
    // "sticky in the pass direction".
    rmSync(partialPath);

    expect(await validateCodeWith(fixClient, CALLER)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_GHOST],
    });
  }, 120_000);
});

/**
 * TASK-12.7: the project graph must be built at server START, not on the first
 * request.
 *
 * Asserted through the warm-up's own durable artifact — the persisted cache file —
 * rather than by timing anything: a client connects and calls NO tool, and the file
 * must still appear. Before the fix nothing built until a request arrived, so the
 * file never appeared and this fails; the polling loop makes it robust on a loaded
 * machine instead of racing a fixed sleep.
 *
 * Why it matters: the cold build takes ~37 s on a real project and Node is
 * single-threaded, so a build triggered by the first `validate_code` starves that
 * lint — a ~1 s call measured 46–58 s.
 */
describe('Integration: the project graph is warmed at server start', () => {
  let warmClient: Client;
  let warmTransport: StdioClientTransport;
  let warmProjectDir: string;
  let warmCachePath: string;

  beforeAll(async () => {
    warmProjectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-warmup-'));
    mkdirSync(join(warmProjectDir, '.git'));
    writeFileSync(
      join(warmProjectDir, '.platformos-check.yml'),
      ['extends: platformos-check:nothing', ''].join('\n'),
      'utf8',
    );
    // A real edge source, so there is something for the graph to be built from.
    const page = join(warmProjectDir, 'app', 'views', 'pages', 'index.liquid');
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, "{% render 'card' %}", 'utf8');
    const partial = join(warmProjectDir, 'app', 'views', 'partials', 'card.liquid');
    mkdirSync(dirname(partial), { recursive: true });
    writeFileSync(partial, '<div>card</div>', 'utf8');

    // Start from a genuinely cold cache: the path is derived from the (unique) temp
    // root, so removing it cannot disturb any other project's cache.
    warmCachePath = defaultGraphCachePath(pathUtils.toUri(warmProjectDir));
    rmSync(warmCachePath, { force: true });

    warmTransport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--project', warmProjectDir],
    });
    warmClient = new Client({ name: 'warmup-client', version: '0.0.0' });
    await warmClient.connect(warmTransport);
  }, 180_000);

  afterAll(async () => {
    await warmClient?.close();
    if (warmCachePath) rmSync(warmCachePath, { force: true });
    if (warmProjectDir) rmSync(warmProjectDir, { recursive: true, force: true });
  });

  it('builds and persists the graph without any tool call', async () => {
    // Deliberately no callTool() anywhere in this test.
    for (let attempt = 0; attempt < 100 && !existsSync(warmCachePath); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(existsSync(warmCachePath)).toBe(true);
  }, 60_000);

  it('answers the first validate_code with an already-computed blast radius', async () => {
    // Deliberately NOT the polling helper: polling would hide the very thing under
    // test by waiting out a background build. The graph is known ready (the test
    // above waited for its persisted file), so the FIRST response must already
    // carry a computed blast radius. Without the boot warm-up this response is
    // `computing`, because the request itself would be what starts the build.
    const res = await warmClient.callTool({
      name: 'validate_code',
      arguments: {
        file_path: 'app/views/partials/card.liquid',
        content: '<div>card, edited</div>',
      },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    const result = JSON.parse(content[0].text);

    expect(result.impact).toEqual({
      scope: 'direct',
      status: 'computed',
      dependents: {
        total: 1,
        by_kind: { render: 1 },
        sample: ['app/views/pages/index.liquid'],
      },
    });
  }, 60_000);
});

/**
 * TASK-17: the MULTI-FILE form of `validate_code` over the real stdio transport —
 * the result envelope and per-file applicability.
 *
 * The CROSS-BUFFER correctness win is deliberately NOT asserted here. This
 * project's hermetic config enables only `MissingContentForLayout`, so a
 * "`render` of a sibling buffer resolves" assertion would pass whether or not the
 * overlay worked — vacuous. It is proven properly, with a failing contrast, in
 * check-node's `lint-buffers.spec.ts`, where `MissingPartial` is enabled.
 *
 * The speed claim is likewise pinned structurally (one adapter call per batch) in
 * `validate-files.spec.ts` rather than by a flaky timing assertion. Measured on a
 * real 162-file project: the same 20-file changeset took 12.25 s as 20
 * `validate_code` calls and 3.06 s as one batch (4.0x).
 */
describe('Integration: the multi-file form over stdio', () => {
  it('declines only the off-project entry and still validates its siblings', async () => {
    const res = await client.callTool({
      name: 'validate_code',
      arguments: {
        files: [
          { file_path: '/etc/passwd', content: 'root:x:0:0' },
          { file_path: 'app/views/layouts/theme.liquid', content: '<html><body></body></html>' },
        ],
      },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    const result = JSON.parse(content[0].text);

    expect(result.files[0].result.not_applicable_reason).toEqual('outside_project');
    // The sibling was still checked, and IT is what gates the changeset.
    expect(result.files[1].result.errors.map((error: { check: string }) => error.check)).toEqual([
      'MissingContentForLayout',
    ]);
    expect(result.must_fix_before_write).toBe(true);
  }, 60_000);
});
