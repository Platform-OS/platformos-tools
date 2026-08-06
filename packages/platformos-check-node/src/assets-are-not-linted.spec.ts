import { afterEach, describe, expect, it } from 'vitest';

import { appCheckRun, lintBuffer } from './index';
import { Tree, Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * Nothing reads an asset — asserted at the layer that was actually wrong.
 *
 * `app/assets/x.liquid` used to be linted like a page. A bare `.liquid` has no response
 * format, so `sourceCodeTypeOf` falls back to `html.liquid` — a key that HAS a parser row
 * — and the file went into the app with the Liquid+HTML parser. Broken Liquid in it drew
 * `LiquidHTMLSyntaxError` from `check()`, and through the MCP supervisor a
 * `must_fix_before_write: true`: a FALSE BLOCK on a file the platform serves verbatim,
 * for the syntax of a language nothing at that path evaluates. Backwards, too —
 * `theme.css.liquid`, the asset form the platform genuinely does process, was exempt all
 * along because `css` IS a format and has no row.
 *
 * The rule lives in `platformos-common` (`isParsedFileType`, applied by `AppFile` and by
 * `isSupportedSourceFile`) and its unit coverage is there. This file exists because unit
 * coverage of a predicate is not the promise that matters: the promise is that a real
 * `check()` over a real project on disk reports nothing on an asset. Those are different
 * claims — the engine could stop consulting `AppFile.type` and every unit test would
 * still pass.
 *
 * EVERY case here is paired with a CONTROL that must still fire. A rule that silenced the
 * whole run, or a fixture with nothing to report, satisfies "no offenses on the asset"
 * just as well as the correct behaviour does.
 */
describe('assets are held by the app and never linted', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** Unparseable Liquid: an unclosed tag, which `LiquidHTMLSyntaxError` always reports. */
  const BROKEN = '{% if unclosed\n';

  /**
   * One asset per spelling that a parser would otherwise accept, plus a page holding the
   * identical broken source as the control.
   *
   * The nested and `marketplace_builder` cases are here because the rule is anchored on
   * the app root: `assets/` has to be recognised under the legacy root and at depth, not
   * just as the literal prefix `app/assets/`.
   */
  const PROJECT: Tree = {
    '.platformos-check.yml': `extends: platformos-check:nothing
LiquidHTMLSyntaxError:
  enabled: true
`,
    app: {
      assets: {
        'x.liquid': BROKEN,
        'page.html.liquid': BROKEN,
        nested: { deep: { 'w.liquid': BROKEN } },
      },
      views: { pages: { 'control.liquid': BROKEN } },
    },
    marketplace_builder: { assets: { 'legacy.liquid': BROKEN } },
  };

  it('reports the page and NOTHING under any assets directory', async () => {
    workspace = await makeTempWorkspace(PROJECT);

    const { offenses } = await appCheckRun(workspace.rootUri.replace('file://', ''));

    // The whole offense set, exactly: one control and no assets. Asserting the complete
    // list rather than "no asset offenses" is what makes the control load-bearing — a
    // rule that silenced everything would fail here and pass a filtered assertion.
    expect(offenses.map((offense) => offense.uri.replace(workspace!.rootUri, ''))).toEqual([
      '/app/views/pages/control.liquid',
    ]);
  });

  it('still holds the assets in the app, so they resolve as files that exist', async () => {
    workspace = await makeTempWorkspace(PROJECT);

    const { app } = await appCheckRun(workspace.rootUri.replace('file://', ''));

    // The other half of "nothing reads an asset, so the only question about one is
    // whether it exists". Not linted is not the same as absent: dropping assets from the
    // app would also produce zero offenses above, while silently breaking every
    // `asset_url` resolution and the graph's asset nodes.
    const assets = app
      .all()
      .map((file) => file.relativePath)
      .filter((relativePath) => relativePath.includes('/assets/'))
      .sort();

    expect(assets).toEqual([
      'app/assets/nested/deep/w.liquid',
      'app/assets/page.html.liquid',
      'app/assets/x.liquid',
      'marketplace_builder/assets/legacy.liquid',
    ]);
  });

  it('tells a buffer-level caller the asset was not checked, rather than that it is clean', async () => {
    workspace = await makeTempWorkspace(PROJECT);
    const root = workspace.rootUri.replace('file://', '');

    // `lintBuffer` is the seam the MCP supervisor validates through, and an empty
    // `offenses` array is exactly what an unchecked file and a clean file have in common.
    // The status is what distinguishes them, and it is the difference between "safe to
    // write" and "we did not look".
    const asset = await lintBuffer({
      root,
      filePath: `${root}/app/assets/x.liquid`,
      content: BROKEN,
    });
    const page = await lintBuffer({
      root,
      filePath: `${root}/app/views/pages/control.liquid`,
      content: BROKEN,
    });

    expect({
      asset: { status: asset.status, offenses: asset.offenses.length },
      page: { status: page.status, checks: page.offenses.map((offense) => offense.check) },
    }).toEqual({
      asset: { status: 'not-a-source-file', offenses: 0 },
      page: { status: 'checked', checks: ['LiquidHTMLSyntaxError'] },
    });
  });
});
