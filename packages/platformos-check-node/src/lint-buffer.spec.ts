import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';

import { getAppAndConfig, lintBuffer } from './index';
import { Workspace, lintBufferOffenses, makeTempWorkspace } from './test/test-helpers';

/**
 * Pins the typed seam the MCP supervisor lints through: `lintBuffer` overlays an
 * in-memory buffer onto the on-disk project and returns structured `Offense[]`
 * (fix/suggest + range intact) — no LSP, no message round-trip.
 */
describe('Unit: lintBuffer', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  afterEach(async () => {
    await workspace?.clean();
  });

  describe('structured offense shape (fix preserved end to end)', () => {
    beforeEach(async () => {
      workspace = await makeTempWorkspace({
        // Enable only a docset-independent, autofixable check so the test is hermetic.
        '.platformos-check.yml': [
          'extends: platformos-check:nothing',
          'JsonLiteralQuoteStyle:',
          '  enabled: true',
          '',
        ].join('\n'),
        app: {
          views: {
            partials: {
              // Benign on disk (double-quoted keys) — the offense must come from the buffer.
              'card.liquid': '{% assign a = {"a": 5} %}',
            },
          },
        },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('returns a structured Offense with check code, numeric range, and a fix for the overlaid buffer', async () => {
      const filePath = path.join(root, 'app/views/partials/card.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% assign a = {'a': 5} %}",
        configPath,
      });

      expect(offenses).toHaveLength(1);
      const [offense] = offenses;
      expect(offense.check).toEqual('JsonLiteralQuoteStyle');
      expect(offense.fix).toBeTypeOf('function');
      expect(typeof offense.start.index).toBe('number');
      expect(typeof offense.end.index).toBe('number');
      expect(offense.end.index).toBeGreaterThan(offense.start.index);
    });
  });

  describe('cross-file checks resolve against the on-disk project with the buffer overlaid', () => {
    beforeEach(async () => {
      workspace = await makeTempWorkspace({
        '.platformos-check.yml': [
          'extends: platformos-check:nothing',
          'MissingPartial:',
          '  enabled: true',
          '',
        ].join('\n'),
        app: {
          views: {
            partials: {
              'exists.liquid': 'hello',
            },
            pages: {
              // Benign on disk — the render call comes from the buffer.
              'home.liquid': '',
            },
          },
        },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('does NOT flag MissingPartial when the buffer renders a partial that exists on disk', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% render 'exists' %}",
        configPath,
      });

      expect(offenses.filter((offense) => offense.check === 'MissingPartial')).toEqual([]);
    });

    it('flags MissingPartial when the buffer renders a partial that does not exist', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% render 'ghost' %}",
        configPath,
      });

      expect(offenses.some((offense) => offense.check === 'MissingPartial')).toBe(true);
    });
  });

  /**
   * The three paths that are never linted. Each of them used to answer with an
   * empty `Offense[]` — the same answer a clean file gives — so a caller that asked
   * "is this file OK?" was told "yes" about a file nothing had looked at.
   */
  describe('says when it did not check the file', () => {
    const content = ["{{ 'x' | no_such_filter }}", "{% render 'ghost' %}", ''].join('\n');

    beforeEach(async () => {
      workspace = await makeTempWorkspace({
        '.platformos-check.yml': [
          'ignore:',
          '  - modules/vendored/**',
          'extends: platformos-check:nothing',
          'MissingPartial:',
          '  enabled: true',
          '',
        ].join('\n'),
        app: {
          assets: { 'app.js': 'console.log(1);' },
          views: { partials: { 'card.liquid': 'hello' } },
        },
        modules: {
          vendored: { public: { views: { partials: { 'button.liquid': 'hi' } } } },
        },
        scripts: { 'helper.liquid': 'hi' },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    const lint = (relativePath: string) =>
      lintBuffer({ root, filePath: path.join(root, relativePath), content, configPath });

    it('checked: an app file the config includes', async () => {
      const result = await lint('app/views/partials/card.liquid');

      expect({
        status: result.status,
        checks: result.offenses.map((offense) => offense.check),
      }).toEqual({ status: 'checked', checks: ['MissingPartial'] });
    });

    it("excluded-by-config: a file the project's ignore list covers", async () => {
      expect(await lint('modules/vendored/public/views/partials/button.liquid')).toEqual({
        status: 'excluded-by-config',
        offenses: [],
      });
    });

    it('not-an-app-file: a path outside every app subtree', async () => {
      expect(await lint('scripts/helper.liquid')).toEqual({
        status: 'not-an-app-file',
        offenses: [],
      });
    });

    it('not-a-source-file: an asset, which no check visits', async () => {
      expect(await lint('app/assets/app.js')).toEqual({
        status: 'not-a-source-file',
        offenses: [],
      });
    });

    it('leaves no trace of an unchecked buffer in the shared app', async () => {
      const { app } = await getAppAndConfig(root, configPath);
      const before = app
        .all()
        .map((file) => file.relativePath)
        .sort();

      await lint('app/assets/app.js');
      await lint('modules/vendored/public/views/partials/button.liquid');
      await lint('scripts/helper.liquid');

      // The app outlives the call, so a file it deliberately does not contain must
      // not be left behind by the overlay of a buffer nothing checked.
      expect(
        app
          .all()
          .map((file) => file.relativePath)
          .sort(),
      ).toEqual(before);
      expect(before).toEqual(['app/views/partials/card.liquid']);
    });
  });
});
