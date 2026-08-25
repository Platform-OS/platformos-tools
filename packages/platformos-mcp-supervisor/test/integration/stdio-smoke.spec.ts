/**
 * Smoke test: build the package, then drive the REAL stdio bin with the
 * official MCP SDK client. Verifies the transport, the `validate_code`
 * registration, the JSON-text result envelope, real linting end to end
 * (check-node → mapped diagnostics), AND the cross-file impact end to end
 * (project scan → resolved references → `impact`).
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
// Run tsc through Node rather than the `node_modules/.bin/tsc` shim: on Windows the shim
// is a `.cmd`, which `execFileSync` cannot launch by its extensionless path.
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
  // Hermetic config: enable only the two checks these tests assert on, so the diagnostics
  // stay deterministic. `MissingRenderPartialArguments` is what impact's cross-file test
  // needs — and its presence here is load-bearing in a second way: impact reuses the
  // project's OWN config, so a check the project disables is one impact cannot report.
  writeFileSync(
    join(projectDir, '.platformos-check.yml'),
    [
      'extends: platformos-check:nothing',
      'MissingContentForLayout:',
      '  enabled: true',
      'MissingRenderPartialArguments:',
      '  enabled: true',
      '',
    ].join('\n'),
    'utf8',
  );

  // A real project on disk so impact is real:
  // `home` renders `card`, passing no arguments.
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
  writeProjectFile(
    'app/lib/queries/list.liquid',
    `{% graphql r = 'noop' %}
{% return r %}`,
  );

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, '--project', projectDir],
  });
  client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await client.connect(transport);
}, 180_000);

/**
 * Call `validate_code` and return the parsed result.
 *
 * NO POLLING, and its absence is a claim: impact is computed from the project during the
 * call, so every response carries a final answer.
 */
async function validateCodeWith(
  withClient: Client,
  args: { file_path: string; content: string; mode?: string },
) {
  const res = await withClient.callTool({ name: 'validate_code', arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  expect(content[0].type).toEqual('text');
  return JSON.parse(content[0].text);
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

  // Checked, and this change broke nobody. NOT a clearance — see `ValidateCodeImpact`.
  const NO_BREAKS = { status: 'computed' };

  /**
   * The whole diagnostic as it crosses the WIRE, suggestion included: a field can survive
   * `toDiagnostic` and still be lost to serialization, and an agent only ever sees this
   * side.
   *
   * `start_index: 33` is the offset of `</body>` in the buffer sent below.
   */
  const MISSING_CONTENT_FOR_LAYOUT = {
    check: 'MissingContentForLayout',
    severity: 'error',
    message:
      "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 1,
    suggestions: [
      {
        description: 'Insert `{{ content_for_layout }}` before the closing </body> tag',
        edits: [{ start_index: 33, end_index: 33, new_text: '{{ content_for_layout }}\n' }],
      },
    ],
    // Enrichment's other contribution: the check's documentation page. `MissingContentForLayout`
    // gained its `docs.url` when all 43 checks were wired to the documentation repo.
    see_also:
      'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-content-for-layout',
  };

  it('advertises exactly the validate_code tool', async () => {
    // ONE tool. A second, similarly-named tool would force the agent to choose between
    // `validate_code` and `validate_files` with nothing in either name to guide it.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['validate_code']);
  });

  it('returns the exact clean result for a valid layout', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: NO_BREAKS,
    });
  });

  it('surfaces the exact lint diagnostic AND the impact together, without conflating them', async () => {
    const result = await validateCode({
      file_path: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [MISSING_CONTENT_FOR_LAYOUT],
      impact: NO_BREAKS,
    });
  });

  it('says nothing cross-file about an edit that breaks nobody, though it HAS a caller', async () => {
    // `card` is rendered by the on-disk `home` page, and this edit does not break it. The
    // caller is deliberately NOT published: impact reports damage, never a dependant list.
    // The cross-file test below is the control — the same file, an edit that does break it.
    const result = await validateCode({
      file_path: 'app/views/partials/card.liquid',
      content: '<div class="card">{{ title }} {{ subtitle }}</div>',
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: NO_BREAKS,
    });
  });

  /**
   * The wire is where a silence has to be proven: `JSON.stringify` drops an `undefined`
   * value, so only a round trip shows the key is ABSENT rather than merely empty. An empty
   * `breaks` would read as "checked, nothing depends on this that could break" — a clearance
   * no scan of the dependants that happen to be VISIBLE can earn. The test below is its
   * control: the same envelope DOES carry the key when a dependant really is broken.
   */
  it('carries no breaks key at all when nothing was found to be broken', async () => {
    const result = await validateCode({
      file_path: 'app/views/partials/lonely.liquid',
      content: `{% doc %}
  @param {string} title - required title
{% enddoc %}
<div>{{ title }}</div>`,
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: { status: 'computed' },
    });
  });

  it('reports the page its edit broke, with the check’s own diagnostic', async () => {
    // `home` renders `card` passing NO args. Give `card` a doc that REQUIRES `title` →
    // `home` is now missing a required param. The finding is the ENGINE'S, reported against
    // a file this request never asked about.
    const result = await validateCode({
      file_path: 'app/views/partials/card.liquid',
      content: `{% doc %}
  @param {string} title - required title
{% enddoc %}
<div class="card">{{ title }}</div>`,
    });

    expect(result).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: {
        status: 'computed',
        breaks: [
          {
            file: 'app/views/pages/home.liquid',
            diagnostics: [
              {
                check: 'MissingRenderPartialArguments',
                severity: 'error',
                message: "Missing required argument 'title' in render tag for partial 'card'.",
                line: 1,
                column: 11,
                end_line: 1,
                end_column: 18,
                // The whole reason for reusing the engine rather than comparing arguments
                // here: the finding arrives with the check's own words, its documentation
                // and an APPLICABLE EDIT. None of that was possible to invent locally.
                suggestions: [
                  {
                    description: "Add required argument 'title'",
                    edits: [{ start_index: 16, end_index: 16, new_text: ", title: ''" }],
                  },
                ],
                see_also:
                  'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-render-partial-arguments',
              },
            ],
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
   */
  const NOT_APPLICABLE_IMPACT = { status: 'not_applicable' };

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
      // intent — a fixture or generator template lives here legitimately.
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
   * A file that is not a platformOS source is usually not meant to be one, so it gets the
   * directory rule and a link rather than "move it under app/".
   *
   * THE CONTROL FOR THE CASE ABOVE, and why the two are separate codes: same status, same
   * non-blocking verdict, opposite advice.
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
 * The loop an agent actually runs: `validate_code` reports a problem, the agent fixes it on
 * disk, `validate_code` is asked again — and must no longer report it.
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
    // Enrichment's contribution, crossing the wire: the check's own documentation page,
    // read from check-common `meta.docs.url`. Not spelled by this package anywhere.
    see_also:
      'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-partial',
  };

  const EMPTY_ENVELOPE = {
    errors: [],
    warnings: [],
    infos: [],
    impact: { status: 'computed' },
  };

  beforeAll(async () => {
    fixProjectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-invalidation-'));
    mkdirSync(join(fixProjectDir, '.git'));
    writeFileSync(
      join(fixProjectDir, '.platformos-check.yml'),
      `extends: platformos-check:nothing
MissingPartial:
  enabled: true
`,
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
 * The FIRST call on a cold server must already carry a real cross-file answer.
 */
describe('Integration: the first call already answers cross-file impact', () => {
  let coldClient: Client;
  let coldTransport: StdioClientTransport;
  let coldProjectDir: string;

  beforeAll(async () => {
    coldProjectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-cold-'));
    mkdirSync(join(coldProjectDir, '.git'));
    writeFileSync(
      join(coldProjectDir, '.platformos-check.yml'),
      // Only the check the cross-file assertion needs. Impact reuses the project's own
      // config, so a project that disables a check is a project impact cannot report it in.
      'extends: platformos-check:nothing\nMissingRenderPartialArguments:\n  enabled: true\n',
      'utf8',
    );
    const page = join(coldProjectDir, 'app', 'views', 'pages', 'index.liquid');
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, "{% render 'card' %}", 'utf8');
    const partial = join(coldProjectDir, 'app', 'views', 'partials', 'card.liquid');
    mkdirSync(dirname(partial), { recursive: true });
    writeFileSync(partial, '<div>card</div>', 'utf8');

    coldTransport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, '--project', coldProjectDir],
    });
    coldClient = new Client({ name: 'cold-client', version: '0.0.0' });
    await coldClient.connect(coldTransport);
  }, 180_000);

  afterAll(async () => {
    await coldClient?.close();
    if (coldProjectDir) rmSync(coldProjectDir, { recursive: true, force: true });
  });

  it('reports the broken caller on the very first request, with no warm-up and no retry', async () => {
    const res = await coldClient.callTool({
      name: 'validate_code',
      arguments: {
        file_path: 'app/views/partials/card.liquid',
        content: `{% doc %}
  @param {string} title - required title
{% enddoc %}
<div>card, edited</div>`,
      },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    const result = JSON.parse(content[0].text);

    expect(result.impact.status).toEqual('computed');
    expect(
      result.impact.breaks.map((broken: { file: string; diagnostics: { check: string }[] }) => ({
        file: broken.file,
        checks: broken.diagnostics.map((diagnostic) => diagnostic.check),
      })),
    ).toEqual([
      { file: 'app/views/pages/index.liquid', checks: ['MissingRenderPartialArguments'] },
    ]);
  }, 60_000);
});

/**
 * The MULTI-FILE form of `validate_code` over the real stdio transport — the result
 * envelope and per-file applicability.
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
