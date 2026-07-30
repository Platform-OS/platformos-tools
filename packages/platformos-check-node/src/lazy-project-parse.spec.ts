import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { AppCache, getApp, loadConfig, lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * Records which files have had their AST realised.
 *
 * A parser spy cannot be used here: check-node's tests resolve check-common to its
 * BUILT dist, so a `vi.mock` of the parser is invisible to the code that actually
 * calls it. Instead this wraps the seam check-node itself calls —
 * `toLazySourceCode` — and records the FIRST read of each `ast`. Because the real
 * implementation memoizes, "first read" is exactly "parsed".
 *
 * The wrapper must never spread the source code: spreading evaluates the getter and
 * would itself trigger the parse it is trying to observe.
 */
const parsed = new Set<string>();
/** Files built through the LAZY seam. Empty means the loader never used it at all. */
const constructed = new Set<string>();

vi.mock('@platformos/platformos-check-common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/platformos-check-common')>();
  return {
    ...actual,
    toLazySourceCode: (uri: string, source: string, version?: number) => {
      const sourceCode = actual.toLazySourceCode(uri, source, version);
      constructed.add(sourceCode.uri);
      const observed = {
        uri: sourceCode.uri,
        source: sourceCode.source,
        type: sourceCode.type,
        version: sourceCode.version,
      };
      Object.defineProperty(observed, 'ast', {
        enumerable: true,
        configurable: true,
        get() {
          parsed.add(sourceCode.uri);
          return sourceCode.ast;
        },
      });
      return observed;
    },
  };
});

/**
 * TASK-12.8: `getApp` reads the whole project so cross-file checks resolve against a
 * complete `App`, but a `validate_code` request visits only the edited buffer
 * (TASK-12.3's `CheckOptions.only`). Parsing the rest is work whose result is never
 * read — on a 162-file project that was seconds per call and the bulk of peak RSS.
 */
describe('Integration: the project is parsed lazily', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;
  let pageFile: string;

  beforeEach(async () => {
    parsed.clear();
    constructed.clear();
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          pages: {
            'index.liquid': "{% render 'card' %}",
            'about.liquid': "{% render 'card' %}",
          },
          partials: {
            'card.liquid': '<div>{{ title }}</div>',
            'unused.liquid': '<div>{{ nobody }}</div>',
            // Deliberately malformed: a lazy load must not turn this into a failed
            // project load, and it must still surface as a captured Error.
            'broken.liquid': '{% if %}{{ ',
          },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
    pageFile = path.join(root, 'app/views/pages/index.liquid');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('reads every file into the App without parsing any of them', async () => {
    const config = await loadConfig(configPath, root);

    const app = await getApp(config);

    // All five liquid files are present as cross-file context...
    expect(app).toHaveLength(5);
    expect(app.every((file) => file.source.length > 0)).toBe(true);
    // ...all five went through the lazy seam (so this assertion cannot pass
    // vacuously if the loader ever reverts to eager)...
    expect(constructed.size).toEqual(5);
    // ...and not one has been parsed.
    expect([...parsed]).toEqual([]);
  });

  it('exposes `ast` as a getter, so nothing pays for a parse it does not read', async () => {
    const config = await loadConfig(configPath, root);

    const [file] = await getApp(config);
    const descriptor = Object.getOwnPropertyDescriptor(file, 'ast')!;

    expect(typeof descriptor.get).toEqual('function');
    expect('value' in descriptor).toBe(false);
  });

  it('realises NONE of the project files when linting a buffer', async () => {
    const offenses = await lintBuffer({
      root,
      filePath: pageFile,
      content: "{% render 'card' %}",
      configPath,
    });

    expect(offenses).toEqual([]);
    // Zero project files parsed. The buffer itself IS parsed, but it is built by the
    // eager `toSourceCode` in `overlayBuffer` — it is the file under check, so its
    // parse is the one parse this call genuinely needs — and therefore never appears
    // at the lazy seam observed here. Everything else stays unparsed even though the
    // cross-file check resolved `card` against the project.
    expect(constructed.size).toEqual(5);
    expect([...parsed]).toEqual([]);
  });

  it('still reports a cross-file offense resolved against unparsed files', async () => {
    const offenses = await lintBuffer({
      root,
      filePath: pageFile,
      content: "{% render 'ghost' %}",
      configPath,
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['MissingPartial']);
  });

  it('does not fail the project load for a malformed file, and captures its error on access', async () => {
    const config = await loadConfig(configPath, root);

    const app = await getApp(config);
    const broken = app.find((file) => file.uri.endsWith('broken.liquid'))!;

    expect(broken).toBeDefined();
    expect(() => broken.ast).not.toThrow();
    expect(broken.ast).toBeInstanceOf(Error);
  });

  it('parses one file per call, not the whole project, across calls sharing an AppCache', async () => {
    const cache = new AppCache();
    const lint = () =>
      lintBuffer({ root, filePath: pageFile, content: "{% render 'card' %}", configPath, cache });

    await lint();
    await lint();
    await lint();

    // Three calls, five project files, zero project parses — the per-call cost is the
    // buffer alone, and a shared AppCache does not change that.
    expect(constructed.size).toEqual(5);
    expect([...parsed]).toEqual([]);
  });

  it('parses a project file only when something actually reads it', async () => {
    const config = await loadConfig(configPath, root);
    const app = await getApp(config);

    const card = app.find((file) => file.uri.endsWith('card.liquid'))!;
    void card.ast;

    expect([...parsed]).toEqual([card.uri]);
  });
});
