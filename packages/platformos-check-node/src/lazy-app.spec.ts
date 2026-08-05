import fs from 'node:fs/promises';
import path from 'node:path';
import { uriFromPath } from '@platformos/platformos-common';
import { afterEach, describe, expect, it } from 'vitest';

import { appCheckRun, getApp, loadConfig, Offense } from './index';
import {
  Tree,
  Workspace,
  lintBufferOffenses,
  makeTempWorkspace,
  withCountedLiquidParses,
} from './test/test-helpers';

/**
 * Pins the central claim: `getApp` reads and parses nothing, and a `lintBuffer` call pays
 * only for the file it visits plus the handful of files that file actually points at.
 * Parse counts are the assertion because they are the cost.
 */
describe('lazy app loading', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** A project with `partialCount` partials, one page, and one translation file. */
  function projectTree(partialCount: number): Tree {
    const partials: Record<string, string> = {};
    for (let i = 0; i < partialCount; i++) {
      partials[`p${i}.liquid`] = `<b>partial ${i}</b>`;
    }

    return {
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        'PartialCallArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        translations: { 'en.yml': 'en:\n  hello: Hello\n' },
        views: {
          partials,
          pages: { 'home.liquid': '' },
        },
      },
    };
  }

  it('getApp reads and parses nothing at all', async () => {
    workspace = await makeTempWorkspace(projectTree(300));
    const config = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(config);

    expect(app.size).toBe(302);
    expect(app.all().filter((file) => file.loaded)).toEqual([]);
  });

  it('lintBuffer parses only the visited file and the render targets it resolves', async () => {
    workspace = await makeTempWorkspace(projectTree(300));
    const root = workspace.root;
    await write(
      root,
      'app/views/partials/documented.liquid',
      '{% doc %}\n  @param {string} title\n{% enddoc %}\n<h1>{{ title }}</h1>\n',
    );

    const parsed = await withCountedLiquidParses(() =>
      lintBufferOffenses({
        root,
        filePath: path.join(root, 'app/views/pages/home.liquid'),
        content: "{% render 'documented', title: 'hi' %}{% render 'p7' %}",
        configPath: path.join(root, '.platformos-check.yml'),
      }),
    );

    expect(parsed.result).toEqual([]);
    // The buffer, plus `documented` and `p7` reached through render resolution.
    // Anything near 300 means the project is being parsed again.
    expect(parsed.parsedUris.length).toBeLessThanOrEqual(4);
    expect(parsed.parsedUris.every((uri) => /home|documented|p7/.test(uri))).toBe(true);
  });

  it('does not throw, or report, for a parse error in a file nobody visits', async () => {
    workspace = await makeTempWorkspace(projectTree(5));
    const root = workspace.root;
    await write(root, 'app/views/partials/broken.liquid', '{% if %}{% unclosed');

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: "{% render 'p1' %}",
      configPath: path.join(root, '.platformos-check.yml'),
    });

    expect(offenses).toEqual([]);
  });

  it('still reports a parse error in the file being visited', async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'LiquidHTMLSyntaxError:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { pages: { 'home.liquid': '' } } },
    });
    const root = workspace.root;

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '{% if %}',
      configPath: path.join(root, '.platformos-check.yml'),
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['LiquidHTMLSyntaxError']);
  });

  it("resolves a render target's {% doc %} params lazily, from the app", async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'UnrecognizedRenderPartialArguments:',
        '  enabled: true',
        'MissingRenderPartialArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
          },
          pages: { 'home.liquid': '' },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const homePath = path.join(root, 'app/views/pages/home.liquid');

    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: homePath,
          content: "{% render 'card', subtitle: 'hi' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([]);

    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: homePath,
          content: "{% render 'card', title: 'hi' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([
      "Missing required argument 'subtitle' in render tag for partial 'card'.",
      "Unknown argument 'title' in render tag for partial 'card'.",
    ]);
  });

  it('cross-references an unsaved buffer against its OWN {% doc %} params', async () => {
    // A self-render is the one call site whose target is the buffer itself, so it is
    // where "the buffer's doc, not the disk copy's doc" is observable. The doc comes
    // from the app — which `lintBuffer` overlays — rather than from a fresh read.
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'UnrecognizedRenderPartialArguments:',
        '  enabled: true',
        'MissingRenderPartialArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
          },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const cardPath = path.join(root, 'app/views/partials/card.liquid');

    // Against the doc ON DISK (`subtitle`), passing `title` is wrong.
    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: cardPath,
          content:
            "{% doc %}\n  @param {string} subtitle\n{% enddoc %}{% render 'card', title: 'x' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([
      "Missing required argument 'subtitle' in render tag for partial 'card'.",
      "Unknown argument 'title' in render tag for partial 'card'.",
    ]);

    // The buffer renaming the param to `title` is what makes the same call correct,
    // even though disk still says `subtitle`.
    expect(
      await lintBufferOffenses({
        root,
        filePath: cardPath,
        content: "{% doc %}\n  @param {string} title\n{% enddoc %}{% render 'card', title: 'x' %}",
        configPath,
      }),
    ).toEqual([]);
  });

  it('lintBuffer matches the whole-project run filtered to the same file', async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        'TranslationKeyExists:',
        '  enabled: true',
        'PartialCallArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        translations: { 'en.yml': 'en:\n  known: Known\n' },
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}',
            ...Object.fromEntries(
              Array.from({ length: 200 }, (_, i) => [`p${i}.liquid`, `<b>${i}</b>`]),
            ),
          },
          pages: {
            'home.liquid': [
              "{% render 'ghost' %}",
              "{% render 'card' %}",
              "{{ 'missing.key' | t }}",
            ].join('\n'),
            'other.liquid': "{% render 'also_ghost' %}",
          },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const homePath = path.join(root, 'app/views/pages/home.liquid');
    // The same conversion the code under test uses, so the two runs' URIs are
    // comparable on Windows too: `URI.file(p).toString()` percent-encodes the drive
    // colon, which matches nothing an `App` produced.
    const homeUri = uriFromPath(homePath);
    const content = await fs.readFile(homePath, 'utf8');

    const wholeProject = await appCheckRun(root, configPath);
    const fromBuffer = await lintBufferOffenses({ root, filePath: homePath, content, configPath });

    expect(comparable(fromBuffer)).toEqual(
      comparable(wholeProject.offenses.filter((offense) => offense.uri === homeUri)),
    );
    // Offenses elsewhere prove the filter is doing real work rather than matching an
    // empty set against an empty set.
    expect(wholeProject.offenses.some((offense) => offense.uri !== homeUri)).toBe(true);
    expect(fromBuffer.length).toBeGreaterThan(0);
  });
});

/** Offenses reduced to the fields that are comparable across two runs. */
function comparable(offenses: Offense[]) {
  return offenses
    .map((offense) => ({
      check: offense.check,
      uri: offense.uri,
      message: offense.message,
      severity: offense.severity,
      start: offense.start,
      end: offense.end,
    }))
    .sort((a, b) => `${a.check}:${a.start.index}`.localeCompare(`${b.check}:${b.start.index}`));
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}
