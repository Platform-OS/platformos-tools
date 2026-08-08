import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PlatformOSDocset,
  TagEntry,
  check as runChecks,
  resolveReplacementTag,
} from '@platformos/platformos-check-common';

import { autofix, getAppAndConfig, resetSharedApp } from './index';
import { NodeFileSystem } from './NodeFileSystem';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * `DeprecatedTag`'s rename is RESOLVED from the docset, not tabulated in the check: the
 * successor is `deprecation_replacement` where the docset states one and is read out of
 * `deprecation_reason` where it does not, and the parser decides whether that successor
 * accepts the markup. Real docset data is the only input that can show either half works, so
 * this suite runs against the docset COMMITTED in `platformos-check-docs-updater` — the file
 * that package's `postbuild` re-downloads from production, so it is production's data, pinned.
 *
 * NO NETWORK, and that is a property of the wiring rather than a hope: the docset is read from
 * that committed file and injected, instead of going through `PlatformOSLiquidDocsManager`,
 * whose `setup()` compares the local revision against documentation.platformos.com and
 * downloads a fresh `tags.json` into a cache directory when they differ. Driving
 * `checkAndAutofix` here would have pinned nine assertions to live remote data — a rephrased
 * reason would fail as "the autofix regressed", and an offline machine would silently exercise
 * a different docset than CI.
 *
 * Same stance as `autofix-export.spec.ts` next door — no test in this package depends on the
 * network — reached differently: that suite has no interest in the docset and picks a check
 * that needs none, while this one's whole subject is the docset and so pins it explicitly.
 *
 * The two halves are separate on purpose. The first says the committed docset still resolves a
 * successor for every tag it deprecates, and fails NAMING the tag that drifted. The second
 * says the rename that implies is what lands on disk.
 */
// Read from the sibling package's checked-in `data/`, the same way this package's other specs
// reach their fixtures. Synchronously, and not as an `import`: `rootDir` is `src`, so a JSON
// import from outside it does not type-check, and a top-level `await` does not either under
// this package's `module` setting.
const COMMITTED_TAGS_PATH = path.join(
  __dirname,
  '../../platformos-check-docs-updater/data/tags.json',
);
const committedTags: TagEntry[] = JSON.parse(readFileSync(COMMITTED_TAGS_PATH, 'utf8'));

const committedDocset: PlatformOSDocset = {
  async tags() {
    return committedTags;
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
  async graphQL() {
    return null;
  },
};

describe('Integration: DeprecatedTag autofix against the committed docset', () => {
  let workspace: Workspace;

  afterEach(async () => {
    resetSharedApp();
    await workspace?.clean();
  });

  /**
   * A tag whose successor the check cannot resolve is still REPORTED — only its rename
   * disappears — so nothing downstream can notice one going missing. Asserted here as a whole
   * map, against the same resolution the check uses, so a docset that drifts shows up as that
   * tag mapping to `undefined` rather than as a mysterious diff in the file the next test
   * writes.
   *
   * Both sources are exercised by the one assertion, because the committed docset is mid-
   * migration: it carries no `deprecation_replacement` yet, so every row here comes from the
   * prose fallback. Once the docs redeploy with the field the rows are unchanged and come from
   * the field instead — which is the point of the field, and the reason this asserts the
   * resolved answer rather than which of the two produced it.
   */
  it('the committed docset resolves a replacement for every tag it deprecates', () => {
    const resolved = Object.fromEntries(
      committedTags
        .filter((tag) => tag.deprecated)
        .map((tag) => [tag.name, resolveReplacementTag(tag, committedTags)]),
    );

    expect(resolved).toEqual({
      context_rc: 'context',
      execute_query: 'graphql',
      function_rc: 'function',
      hash_assign: 'assign',
      query_graph: 'graphql',
      render_form: 'include_form',
      return_rc: 'return',
      sign_in_rc: 'sign_in',
      try_rc: 'try',
    });
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
