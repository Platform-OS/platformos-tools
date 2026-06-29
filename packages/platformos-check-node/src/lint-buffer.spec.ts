import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

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
      root = URI.parse(workspace.rootUri).fsPath;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('returns a structured Offense with check code, numeric range, and a fix for the overlaid buffer', async () => {
      const filePath = path.join(root, 'app/views/partials/card.liquid');
      const offenses = await lintBuffer({
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
      root = URI.parse(workspace.rootUri).fsPath;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('does NOT flag MissingPartial when the buffer renders a partial that exists on disk', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBuffer({
        root,
        filePath,
        content: "{% render 'exists' %}",
        configPath,
      });

      expect(offenses.filter((offense) => offense.check === 'MissingPartial')).toEqual([]);
    });

    it('flags MissingPartial when the buffer renders a partial that does not exist', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBuffer({
        root,
        filePath,
        content: "{% render 'ghost' %}",
        configPath,
      });

      expect(offenses.some((offense) => offense.check === 'MissingPartial')).toBe(true);
    });
  });
});
