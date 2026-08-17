import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getApp, loadConfig, resetSharedApp } from '../index';
import { makeTempWorkspace, Workspace } from '../test/test-helpers';
import { backfillDocs } from './index';

/**
 * `backfillDocs` had specs for each of its three helpers and none for the command
 * itself, so nothing pinned what it actually writes.
 */
describe('Unit: backfillDocs', () => {
  const PAGE = "{% function res = 'helper', title: 'x', count: 2 %}";
  let workspace: Workspace;
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);

  beforeEach(async () => {
    logged.length = 0;
    resetSharedApp();
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': 'extends: platformos-check:nothing\n',
      app: {
        views: {
          pages: { 'index.liquid': PAGE },
          partials: { 'helper.liquid': '{{ title }}' },
        },
      },
    });
  });

  afterEach(async () => {
    resetSharedApp();
    await workspace.clean();
  });

  const read = (relativePath: string) => fs.readFile(`${workspace.root}/${relativePath}`, 'utf8');

  it('documents the arguments the partial actually uses, and leaves the unused one out', async () => {
    const result = await backfillDocs({ rootPath: workspace.root }, log);

    expect(result).toEqual({ modified: ['helper'], skipped: [], errors: [] });
    // `count` is passed by the call site but never read in the partial, so it is not
    // documented — the same rule the argument collector's own spec states.
    expect(await read('app/views/partials/helper.liquid')).toEqual(
      ['{% doc %}', '  @param {string} [title]', '{% enddoc %}', '{{ title }}'].join('\n'),
    );
  });

  it('documents the app’s copy of the partial, including an unsaved buffer', async () => {
    const config = await loadConfig(undefined, workspace.root);
    const app = await getApp(config);
    // The same shared app `backfillDocs` will ask for, carrying content that is not on
    // disk. A version is what marks it an unsaved buffer, so reconciliation leaves it be.
    app.setSource(workspace.uri('app/views/partials/helper.liquid'), '{{ count }}', 0);

    const result = await backfillDocs({ rootPath: workspace.root, dryRun: true }, log);

    // `count` is now the used variable and `title` the unused one: the reverse of the
    // test above, from the same call site and the same disk.
    expect(result).toEqual({ modified: ['helper'], skipped: [], errors: [] });
    expect(logged.some((line) => line.includes('Added: count'))).toBe(true);
    // dryRun: disk is untouched, so the buffer cannot be written back over it.
    expect(await read('app/views/partials/helper.liquid')).toEqual('{{ title }}');
  });
});
