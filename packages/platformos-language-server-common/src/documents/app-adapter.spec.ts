import { SourceCodeType } from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { PlatformOSFileType } from '@platformos/platformos-common';
import { appBackedGetSourceCode } from '@platformos/platformos-graph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentManager, languageServerParsers } from './DocumentManager';

/**
 * `DocumentManager` is the language server's view of the SAME `App` the linter and
 * the graph build hold — not a second, LSP-shaped store of source codes beside it.
 *
 * What that buys, and what these pin:
 *
 * - opening a workspace no longer parses it (the parse is `AppFile`'s, on first
 *   `ast`), so a file nobody looks at costs a read and nothing else;
 * - `set` asks "is this part of an app" WITH a root, the way every other consumer
 *   does, instead of the rootless "can we parse it" it had to settle for;
 * - the graph and the checks read the same file objects, so each file is parsed
 *   once for both rather than once each.
 */
describe('Module: DocumentManager as an App adapter', () => {
  const root = 'mock-fs:';
  const foo = 'mock-fs:/app/views/partials/foo.liquid';
  const bar = 'mock-fs:/app/views/partials/bar.liquid';
  const query = 'mock-fs:/app/graphql/find_user.graphql';

  let files: Record<string, string>;
  let fs: MockFileSystem;
  let manager: DocumentManager;
  let parseLiquid: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    files = {
      'app/views/partials/foo.liquid': `hello {% render 'bar' %}`,
      'app/views/partials/bar.liquid': `world`,
      'app/graphql/find_user.graphql': `query find_user { users { id } }`,
      'app/assets/app.js': `export const x = 1;`,
      // Under the root, readable by our parsers, and NOT deployed: `scripts/` is
      // not an app subtree, and `seed/` merely CONTAINS a path that looks like one.
      'scripts/build.liquid': `not deployed`,
      'seed/post_import/app/views/partials/scratch.liquid': `also not deployed`,
    };
    fs = new MockFileSystem(files, root);
    manager = new DocumentManager(fs);
    parseLiquid = vi.spyOn(languageServerParsers as any, SourceCodeType.LiquidHtml);
  });

  // `languageServerParsers` is a module-level singleton — the spy has to come back
  // off it, or the next test counts this one's parses too.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('preload', () => {
    it('reads the app source files and parses none of them', async () => {
      await manager.preload(root);

      expect(parseLiquid).not.toHaveBeenCalled();
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });

    it('parses a file once, on the first read of its ast', async () => {
      await manager.preload(root);

      const document = manager.get(foo)!;
      expect(document.ast).toBe(document.ast);
      expect(parseLiquid.mock.calls).toEqual([[`hello {% render 'bar' %}`, foo]]);
    });

    it('leaves a parse error as a captured Error rather than throwing', async () => {
      files['app/views/partials/foo.liquid'] = `{% if %}`;

      await manager.preload(root);

      expect(manager.get(foo)!.ast).toBeInstanceOf(Error);
    });
  });

  /**
   * `version === undefined` means "this is what is on disk"; a number means "this
   * is an editor buffer". Several features read nothing else to tell them apart.
   */
  describe('app(root, includeFilesFromDisk)', () => {
    beforeEach(async () => {
      await manager.preload(root);
    });

    it('returns only the open buffers by default', () => {
      expect(manager.app(root)).toEqual([]);

      manager.open(foo, 'edited', 7);

      expect(manager.app(root).map((file) => [file.uri, file.version])).toEqual([[foo, 7]]);
    });

    it('returns every app source file with includeFilesFromDisk, open or not', () => {
      manager.open(foo, 'edited', 7);

      expect(manager.app(root, true).map((file) => [file.uri, file.version])).toEqual([
        [foo, 7],
        [bar, undefined],
        [query, undefined],
      ]);
    });

    it('never returns a file the platform does not deploy, or one it cannot parse', () => {
      // `app/assets/app.js` is in the app and is a graph node; it has no
      // SourceCodeType, so no check can be written against it.
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });
  });

  describe('the operations, against the App they leave behind', () => {
    beforeEach(async () => {
      await manager.preload(root);
    });

    it('open and change record the buffer and its version', () => {
      manager.open(foo, 'opened', 1);
      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['opened', 1]);

      manager.change(foo, 'changed', 2);
      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['changed', 2]);
    });

    it('changeFromDisk replaces the contents and drops the version', async () => {
      manager.open(foo, 'opened', 1);
      files['app/views/partials/foo.liquid'] = 'from disk';

      await manager.changeFromDisk(foo);

      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual([
        'from disk',
        undefined,
      ]);
    });

    it('close keeps the contents and drops the version', () => {
      manager.open(foo, 'opened', 1);

      manager.close(foo);

      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['opened', undefined]);
    });

    it('delete removes the file from the app', () => {
      expect(manager.delete(foo)).toBe(true);

      expect(manager.get(foo)).toBe(undefined);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([bar, query]);
    });

    /**
     * The app holds the file the moment its PATH is classified, which is before the
     * read that gives it contents. `AppFile.source` throws rather than pretending to
     * be `''`, so a document exists here exactly when its contents do — the same set
     * the `Map<uri, SourceCode>` this replaced held, since it only got an entry once
     * the read returned.
     *
     * Getting this wrong is silent and expensive: `runChecks` resolves a partial's
     * `{% doc %}` through `get()`, so a file that answered before it was read would
     * cost every cross-file diagnostic that depends on it.
     */
    it('does not hand out a file whose contents have not been read', () => {
      const unread = 'mock-fs:/app/views/partials/added.liquid';
      manager.appModel(root).update([unread]);

      expect(manager.appModel(root).has(unread)).toBe(true);
      expect(manager.get(unread)).toBe(undefined);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });

    it('rename moves the contents and the version to the new uri', () => {
      const renamed = 'mock-fs:/app/views/partials/renamed.liquid';
      manager.open(foo, 'opened', 3);

      manager.rename(foo, renamed);

      expect(manager.get(foo)).toBe(undefined);
      expect([manager.get(renamed)!.source, manager.get(renamed)!.version]).toEqual(['opened', 3]);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([bar, query, renamed]);
      expect([manager.hasRecentRename(foo), manager.hasRecentRename(renamed)]).toEqual([
        true,
        true,
      ]);
    });

    /**
     * Even with no contents to carry over. The old path is gone from disk, and an
     * app that still lists it hands the graph a file to read that is not there.
     */
    it('rename drops the old path from the app when its contents were never read', () => {
      const unread = 'mock-fs:/app/views/partials/added.liquid';
      manager.appModel(root).update([unread]);

      manager.rename(unread, 'mock-fs:/app/views/partials/moved.liquid');

      expect(manager.appModel(root).has(unread)).toBe(false);
    });

    /**
     * Removing an `app/modules/X` overwrite promotes the `modules/X` original back
     * — the App's own rule, and the reason `delete` goes through it rather than
     * dropping a map entry.
     */
    it('delete of a module overwrite leaves the original resolving', async () => {
      files['modules/core/public/views/partials/card.liquid'] = 'the original';
      files['app/modules/core/public/views/partials/card.liquid'] = 'the overwrite';
      manager = new DocumentManager(new MockFileSystem(files, root));
      await manager.preload(root);
      const overwrite = 'mock-fs:/app/modules/core/public/views/partials/card.liquid';
      const original = 'mock-fs:/modules/core/public/views/partials/card.liquid';

      expect(
        manager.appModel(root).find(PlatformOSFileType.Partial, 'modules/core/card')!.uri,
      ).toBe(overwrite);

      manager.delete(overwrite);

      expect(
        manager.appModel(root).find(PlatformOSFileType.Partial, 'modules/core/card')!.uri,
      ).toBe(original);
    });
  });

  /**
   * The question `set` could not ask before this class held an `App`.
   *
   * A platformOS file is one whose position RELATIVE TO THE PROJECT ROOT matches the
   * directory structure — that is what `getFileType`, `AppGraph` and every check ask.
   * `set` had no root, so it asked `sourceCodeTypeOf` instead ("can we parse it"),
   * and the app-membership question was deferred to `app(root)`. Now the app the URI
   * falls under supplies the root and both are answered in one place.
   */
  describe('classification with a root', () => {
    const script = 'mock-fs:/scripts/build.liquid';
    const seed = 'mock-fs:/seed/post_import/app/views/partials/scratch.liquid';

    beforeEach(async () => {
      await manager.preload(root);
    });

    it('keeps a readable file the platform does not deploy out of the app', () => {
      manager.open(script, 'not deployed', 1);
      manager.open(seed, 'also not deployed', 1);

      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
      expect([manager.appModel(root).has(script), manager.appModel(root).has(seed)]).toEqual([
        false,
        false,
      ]);
    });

    /**
     * It is still a document. The editor formats, highlights and completes in a
     * `.liquid` file wherever it is; what it does not get is diagnostics, or a node
     * in the app graph, because it is not part of the app.
     */
    it('still manages it as an editor document', () => {
      manager.open(script, '{{ "hi" }}', 1);

      const document = manager.get(script)!;
      expect([document.uri, document.type, document.source, document.version]).toEqual([
        script,
        SourceCodeType.LiquidHtml,
        '{{ "hi" }}',
        1,
      ]);
      expect(document.textDocument.getText()).toBe('{{ "hi" }}');
      expect(manager.openDocuments.map((file) => file.uri)).toEqual([script]);
    });

    it('does not manage a buffer it has no parser for', () => {
      manager.open('mock-fs:/app/assets/theme.css.liquid', 'a { color: red }', 1);

      expect(manager.get('mock-fs:/app/assets/theme.css.liquid')).toBe(undefined);
    });
  });

  /**
   * `didOpen` arrives before anything has asked which project the file belongs to,
   * so the buffer lands before there is a root to classify it against. It must not
   * be lost, and it must not stay outside the app once the root IS named.
   */
  describe('a buffer opened before its root is known', () => {
    it('joins the app the moment a root is named', () => {
      manager.open(foo, 'opened first', 4);

      expect(manager.get(foo)!.source).toBe('opened first');

      expect(manager.app(root, true).map((file) => [file.uri, file.source, file.version])).toEqual([
        [foo, 'opened first', 4],
      ]);
      expect(manager.appModel(root).has(foo)).toBe(true);
    });
  });

  /**
   * The double parse this epic set out to remove, at its last site: a process that
   * builds a graph AND runs checks over one project.
   */
  describe('sharing one parse with the graph', () => {
    it('serves the graph the very file objects the checks read', async () => {
      await manager.preload(root);
      const getSourceCode = appBackedGetSourceCode(manager.appModel(root), async () => {
        throw new Error('the app should have contained it');
      });

      const forTheGraph = await getSourceCode(foo);
      const forTheChecks = manager.get(foo)!;

      expect(forTheGraph).toBe(forTheChecks);
      expect(forTheGraph.ast).toBe(forTheChecks.ast);
      expect(parseLiquid.mock.calls).toEqual([[`hello {% render 'bar' %}`, foo]]);
    });

    it('parses the assets only the graph reads, with the graph parser', async () => {
      await manager.preload(root);
      const getSourceCode = appBackedGetSourceCode(manager.appModel(root), async () => {
        throw new Error('the app should have contained it');
      });

      const asset = await getSourceCode('mock-fs:/app/assets/app.js');

      expect((asset.ast as { type: string }).type).toBe('Program');
      // A `.js` asset is a graph node and never an editor document.
      expect(manager.get('mock-fs:/app/assets/app.js')).toBe(undefined);
    });
  });
});
