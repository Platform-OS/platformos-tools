import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FixApplicator,
  PlatformOSDocset,
  TagEntry,
  applyFixToString,
  check as runChecks,
} from '@platformos/platformos-check-common';

import { appCheckRun, autofix, getAppAndConfig, resetSharedApp } from './index';
import { NodeFileSystem } from './NodeFileSystem';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * `index.ts` re-exports all of check-common, which has an `autofix` of its own taking a
 * REQUIRED third `FixApplicator` argument. This package's `autofix` defaults that argument
 * (to writing to disk) and must be the one on the public surface — pos-cli's check worker
 * calls `autofix(app, offenses)`, and when the star export won that call died with
 * `applyFixes is not a function` and no file was ever written.
 *
 * Both arities are pinned here because both have been on the surface, and the failure mode
 * of the three-argument one is invisible from the caller's side: an applicator whose whole
 * purpose is to keep fixed sources OUT of the filesystem was silently dropped, and the files
 * were rewritten with no error and no change in the return value.
 *
 * Asserted through the exported name rather than by importing `./autofix` directly: the
 * module was always correct, it was the export that was shadowed.
 */
describe('Unit: the exported autofix', () => {
  let workspace: Workspace;

  afterEach(async () => {
    resetSharedApp();
    await workspace?.clean();
  });

  /** One docset-independent, autofixable check, so these tests need no network. */
  async function fixableWorkspace() {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'JsonLiteralQuoteStyle:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'fixable.liquid': "{% assign a = {'a': 5} %}",
            'clean.liquid': '{% assign b = {"b": 6} %}',
          },
        },
      },
    });

    const run = await appCheckRun(workspace.root);
    expect(run.offenses.map((offense) => offense.check)).toEqual(['JsonLiteralQuoteStyle']);

    return {
      ...run,
      fixable: path.join(workspace.root, 'app/views/partials/fixable.liquid'),
      clean: path.join(workspace.root, 'app/views/partials/clean.liquid'),
    };
  }

  it('writes to disk when no applicator is given', async () => {
    const { app, offenses, fixable, clean } = await fixableWorkspace();

    await autofix(app, offenses);

    expect(await fs.readFile(fixable, 'utf8')).toEqual('{% assign a = {"a": 5} %}');
    // The control: a file with no offense is left exactly as it was, so the assertion
    // above is about the fix and not about every file being rewritten.
    expect(await fs.readFile(clean, 'utf8')).toEqual('{% assign b = {"b": 6} %}');
  });

  it('honours a caller-supplied applicator and leaves the filesystem alone', async () => {
    const { app, offenses, fixable, clean } = await fixableWorkspace();
    const collected = new Map<string, string>();
    const collect: FixApplicator = async (sourceCode, fix) => {
      collected.set(sourceCode.uri, applyFixToString(sourceCode.source, fix));
    };

    await autofix(app, offenses, collect);

    // The fix reached the applicator, so the silence on disk below is not "no fix ran".
    expect([...collected.values()]).toEqual(['{% assign a = {"a": 5} %}']);
    expect(await fs.readFile(fixable, 'utf8')).toEqual("{% assign a = {'a': 5} %}");
    expect(await fs.readFile(clean, 'utf8')).toEqual('{% assign b = {"b": 6} %}');
  });
});

/**
 * `DeprecatedTag`'s rename is RESOLVED, not tabulated: the successor is whatever the docset's
 * `deprecation_replacement` states, and the PARSER decides whether that successor's grammar
 * accepts the occurrence's markup. This suite is about that second half — the end-to-end path
 * from a rename decision to bytes on disk — which is this package's own machinery.
 *
 * THE DOCSET IS A FIXTURE, NOT A SUBJECT. Whether `tags.json` names the right successor for a
 * tag is verified where it is authored and gated, in
 * `docs/scripts/verify_tags_json.rb`; re-asserting it here would duplicate that gate and fail
 * on a docs release that is perfectly correct. So the entries below are declared, using real
 * tag names and the successors the platform really states — enough to drive every branch, and
 * decoupled from the docs' release cadence.
 *
 * NO NETWORK, as a property of the wiring rather than a hope: the docset is injected, instead
 * of going through `PlatformOSLiquidDocsManager`, whose `setup()` compares the local revision
 * against documentation.platformos.com and downloads a fresh `tags.json` when they differ.
 */
const fixtureTags: TagEntry[] = [
  // Renamed: the replacement's grammar accepts the markup unchanged.
  { name: 'hash_assign', deprecated: true, deprecation_replacement: 'assign' },
  { name: 'assign' },
  { name: 'render_form', deprecated: true, deprecation_replacement: 'include_form' },
  { name: 'include_form' },
  { name: 'context_rc', deprecated: true, deprecation_replacement: 'context' },
  { name: 'context' },
  { name: 'function_rc', deprecated: true, deprecation_replacement: 'function' },
  { name: 'function' },
  { name: 'return_rc', deprecated: true, deprecation_replacement: 'return' },
  { name: 'return' },
  { name: 'sign_in_rc', deprecated: true, deprecation_replacement: 'sign_in' },
  { name: 'sign_in' },
  // A block tag, so both ends move or the result does not parse.
  { name: 'try_rc', deprecated: true, deprecation_replacement: 'try' },
  { name: 'try' },
  // Left alone: `graphql` wants `graphql g = "path/to/query"`, so carrying this markup over
  // would produce a template the platform cannot parse.
  { name: 'execute_query', deprecated: true, deprecation_replacement: 'graphql' },
  { name: 'query_graph', deprecated: true, deprecation_replacement: 'graphql' },
  { name: 'graphql' },
];

const committedDocset: PlatformOSDocset = {
  async tags() {
    return fixtureTags;
  },
  async filters() {
    return [];
  },
  async objects() {
    return [];
  },
  async liquidDrops() {
    return [];
  },
  async liquidDoc() {
    return { annotations: [], param_types: [] };
  },
  async graphQL() {
    return null;
  },
};

describe('Integration: DeprecatedTag autofix writes the rename to disk', () => {
  let workspace: Workspace;

  afterEach(async () => {
    resetSharedApp();
    await workspace?.clean();
  });

  it('renames exactly the deprecated tags whose replacement accepts their markup', async () => {
    const source = [
      // Renamed: the replacement's grammar accepts the markup unchanged.
      `{% hash_assign h['k'] = 1 %}`,
      `{% render_form 'path/to/form' %}`,
      `{% context_rc language: 'en' %}`,
      `{% function_rc x = 'path/to/partial' %}`,
      `{% return_rc x %}`,
      `{% sign_in_rc user_id: 1 %}`,
      // Renamed at BOTH ends — half a rename would not parse.
      `{% try_rc %}body{% endtry_rc %}`,
      // Left alone: `graphql` wants `graphql g = "path/to/query"`, so carrying this markup
      // over would produce a template the platform cannot parse.
      `{% execute_query 'q', result_name: 'g' %}`,
      `{% query_graph 'q', result_name: 'g' %}`,
      // Left alone: markup that does not parse under the replacement either.
      `{% hash_assign broken %}`,
    ].join('\n');

    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'DeprecatedTag:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { partials: { 'each.liquid': source } } },
    });
    const file = path.join(workspace.root, 'app/views/partials/each.liquid');

    const { app, config } = await getAppAndConfig(workspace.root);
    const offenses = await runChecks(app, config, {
      fs: NodeFileSystem,
      platformosDocset: committedDocset,
    });
    await autofix(app, offenses);

    expect(await fs.readFile(file, 'utf8')).toEqual(
      [
        `{% assign h['k'] = 1 %}`,
        `{% include_form 'path/to/form' %}`,
        `{% context language: 'en' %}`,
        `{% function x = 'path/to/partial' %}`,
        `{% return x %}`,
        `{% sign_in user_id: 1 %}`,
        `{% try %}body{% endtry %}`,
        `{% execute_query 'q', result_name: 'g' %}`,
        `{% query_graph 'q', result_name: 'g' %}`,
        `{% hash_assign broken %}`,
      ].join('\n'),
    );
  });
});
