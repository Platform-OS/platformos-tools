import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FixApplicator, applyFixToString } from '@platformos/platformos-check-common';

import { appCheckRun, autofix, resetSharedApp } from './index';
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
