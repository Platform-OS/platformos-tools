import {
  allChecks,
  CheckDefinition,
  LiquidCheckDefinition,
  path,
  Severity,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { nameToPaths, PlatformOSFileType, RouteTable } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from 'vscode-languageserver';
import { DocumentManager } from '../documents';
import { DocumentBackedFileSystem } from '../server/DocumentBackedFileSystem';
import { DiagnosticsManager } from './DiagnosticsManager';
import { makeRunChecks } from './runChecks';

const LiquidFilter: LiquidCheckDefinition = {
  meta: {
    code: 'LiquidFilter',
    name: 'Complains about every LiquidFilter',
    docs: {
      description: 'Complains about every LiquidFilter',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      LiquidFilter: async (node) => {
        context.report({
          message: 'Liquid filter can not be used',
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};

describe('Module: runChecks', () => {
  let diagnosticsManager: DiagnosticsManager;
  let documentManager: DocumentManager;
  let connection: { sendDiagnostics: ReturnType<typeof vi.fn> };
  let runChecks: ReturnType<typeof makeRunChecks>;
  let fs: MockFileSystem;
  const rootUri = path.normalize('browser:///app');
  const fileUri = path.join(rootUri, 'app', 'views', 'pages', 'input.liquid');

  beforeEach(() => {
    connection = {
      sendDiagnostics: vi.fn(),
    };

    documentManager = new DocumentManager();
    diagnosticsManager = new DiagnosticsManager(connection as any as Connection);
    fs = new MockFileSystem(
      {
        '.pos': '',
        'app/views/pages/input.liquid': `{{ 'any' | filter }}`,
        '.git/test': 'test',
        'modules/test': 'test',
      },
      rootUri,
    );
    runChecks = makeRunChecks(documentManager, diagnosticsManager, {
      fs,
      loadConfig: async () => ({
        settings: {},
        checks: [LiquidFilter],
        rootUri,
      }),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      jsonValidationSet: {
        schemas: async () => [],
      },
    });
  });

  it('should send diagnostics when there are errors', async () => {
    const fileContents = await fs.readFile(fileUri);
    const fileVersion = 0;
    documentManager.open(fileUri, fileContents, fileVersion);

    await runChecks([fileUri]);
    expect(connection.sendDiagnostics).toBeCalled();
    expect(connection.sendDiagnostics).toBeCalledWith({
      uri: fileUri,
      version: fileVersion,
      diagnostics: [
        {
          source: 'platformos-check',
          code: 'LiquidFilter',
          message: 'Liquid filter can not be used',
          severity: 1,
          range: {
            start: {
              line: 0,
              character: 8,
            },
            end: {
              line: 0,
              character: 17,
            },
          },
        },
      ],
    });
  });

  it('should send an empty array when the errors were cleared', async () => {
    const fileContentsWithError = `{{ 'any' | filter }}`;
    const fileContentsWithoutError = `{{ 'any' }}`;
    let fileVersion = 1;

    // Open and have errors
    documentManager.open(fileUri, fileContentsWithError, fileVersion);
    await runChecks([fileUri]);

    // Change doc to fix errors
    fileVersion = 2;
    documentManager.change(fileUri, fileContentsWithoutError, fileVersion);
    await runChecks([fileUri]);

    expect(connection.sendDiagnostics).toBeCalledTimes(2);
    expect(connection.sendDiagnostics).toHaveBeenLastCalledWith({
      uri: fileUri,
      version: fileVersion,
      diagnostics: [],
    });
  });

  it('should send diagnostics per URI when there are errors', async () => {
    const files = [
      {
        fileURI: path.join(rootUri, 'app', 'views', 'pages', 'input1.liquid'),
        fileContents: `{{ 'any' | filter }}`,
        fileVersion: 0,
        diagnostics: [
          {
            source: 'platformos-check',
            code: 'LiquidFilter',
            message: 'Liquid filter can not be used',
            severity: 1,
            range: {
              start: {
                line: 0,
                character: 8,
              },
              end: {
                line: 0,
                character: 17,
              },
            },
          },
        ],
      },
      {
        fileURI: path.join(rootUri, 'app', 'views', 'pages', 'input2.liquid'),
        // same but on a new line
        fileContents: `\n{{ 'any' | filter }}`,
        fileVersion: 0,
        diagnostics: [
          {
            source: 'platformos-check',
            code: 'LiquidFilter',
            message: 'Liquid filter can not be used',
            severity: 1,
            range: {
              start: {
                line: 1,
                character: 8,
              },
              end: {
                line: 1,
                character: 17,
              },
            },
          },
        ],
      },
    ];

    files.forEach(({ fileURI, fileContents, fileVersion }) => {
      documentManager.open(fileURI, fileContents, fileVersion);
    });

    await runChecks([path.join(rootUri, 'app', 'views', 'pages', 'input1.liquid')]);

    files.forEach(({ fileURI, fileVersion, diagnostics }) => {
      expect(connection.sendDiagnostics).toBeCalledWith({
        uri: fileURI,
        version: fileVersion,
        diagnostics,
      });
    });
  });

  it('should use the contents of the default translations file buffer (if any) instead of the result of the factory', async () => {
    const defaultPath = 'app/translations/en.yml';
    const defaultURI = path.join(rootUri, ...defaultPath.split('/'));
    const frPath = 'app/translations/fr.yml';
    const frURI = path.join(rootUri, ...frPath.split('/'));
    const files = {
      '.pos': '',
      'app/test': '',
      '.git/test': 'test',
      'modules/test': 'test',
      [defaultPath]: `en:
  hello: hello`,
      [frPath]: `fr:
  hello: bonjour
  hi: salut`,
    };

    const matchingTranslation = allChecks.filter((c) => c.meta.code === 'MatchingTranslations');
    expect(matchingTranslation).to.have.lengthOf(1);
    runChecks = makeRunChecks(documentManager, diagnosticsManager, {
      fs: new MockFileSystem(files, rootUri),
      loadConfig: async () => ({
        settings: {},
        checks: matchingTranslation,
        rootUri: rootUri,
      }),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      jsonValidationSet: {
        schemas: async () => [],
      },
    });

    // Open and have errors
    documentManager.open(frURI, files[frPath], 0);
    await runChecks([frURI]);
    expect(connection.sendDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: frURI,
        version: 0,
        diagnostics: expect.arrayContaining([
          {
            source: 'platformos-check',
            code: 'MatchingTranslations',
            codeDescription: { href: expect.any(String) },
            message: `A translation for 'hi' does not exist in the en locale`,
            severity: 1,
            range: {
              // The fixture is `'fr:\n  hello: bonjour\n  hi: salut'`.
              // Line 2 starts at offset 21 and 'hi: salut' occupies offsets 23-31, so
              // the exclusive end offset is 32 — the length of the source, since the
              // fixture has no trailing newline.
              //
              // This asserted `character: 10` while `getPosition` could not name a
              // position past the last character: it clamped an end-of-input offset
              // onto that character, and the range came back one short, highlighting
              // 'hi: salu'. Every diagnostic ending at end of input was truncated the
              // same way, in the editor as well as here.
              start: { line: 2, character: 2 },
              end: { line: 2, character: 11 },
            },
          },
        ]),
      }),
    );

    // Change the contents of the defaultURI buffer, expect frURI to be fixed
    documentManager.open(defaultURI, files[defaultPath], 0);
    documentManager.change(
      defaultURI,
      `en:
  hello: hello
  hi: hi`,
      1,
    );
    connection.sendDiagnostics.mockClear();
    await runChecks([frURI]);
    expect(connection.sendDiagnostics).toHaveBeenCalledWith({
      uri: frURI,
      version: 0,
      diagnostics: [],
    });
  });

  describe('when a referenced partial is edited in the editor', () => {
    const callerURI = path.join(rootUri, 'app', 'views', 'pages', 'index.liquid');
    const partialURI = path.join(rootUri, 'app', 'lib', 'my_partial.liquid');
    // The caller passes `arg`, which is only a known parameter once the partial
    // references it.
    const caller = `{% function res = 'my_partial', arg: 'value' %}`;
    // On disk the partial only knows `followships`, so `arg` looks unknown.
    const partialOnDisk = `{% liquid\n  assign followships = followships | default: null\n%}`;
    // In the editor the partial now uses `arg`, making it a known parameter.
    const partialInBuffer = `{% liquid\n  log arg, type: 'arg'\n  assign followships = followships | default: null\n%}`;

    const partialCallArguments = allChecks.filter((c) => c.meta.code === 'PartialCallArguments');

    const unknownArgDiagnostic = {
      source: 'platformos-check',
      code: 'PartialCallArguments',
      codeDescription: { href: expect.any(String) },
      message: 'Unknown parameter arg passed to function call',
      severity: 1,
      range: {
        start: { line: 0, character: 32 },
        end: { line: 0, character: 44 },
      },
    };

    function makeRunChecksWithFs(fs: MockFileSystem | DocumentBackedFileSystem) {
      return makeRunChecks(documentManager, diagnosticsManager, {
        fs: fs as MockFileSystem,
        loadConfig: async () => ({
          settings: {},
          checks: partialCallArguments,
          rootUri,
        }),
        platformosDocset: {
          graphQL: async () => null,
          filters: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          tags: async () => [],
        },
        jsonValidationSet: {
          schemas: async () => [],
        },
      });
    }

    beforeEach(() => {
      expect(partialCallArguments).to.have.lengthOf(1);
      fs = new MockFileSystem(
        {
          '.pos': '',
          'app/views/pages/index.liquid': caller,
          'app/lib/my_partial.liquid': partialOnDisk,
        },
        rootUri,
      );
      documentManager.open(callerURI, caller, 0);
      documentManager.open(partialURI, partialInBuffer, 0);
    });

    /**
     * The first arm used to assert the OPPOSITE — that a plain filesystem yields a STALE
     * offense — as the control proving `DocumentBackedFileSystem` was what made the buffer
     * visible. It no longer does: `inferredTargetParams` resolves the target through the
     * `App`, which is document-backed, so the buffer wins whatever the filesystem is. The App
     * also already holds the parse, which is why it is asked first.
     *
     * So the two arms are now green for the same reason, and they are one test rather than
     * two because that is what they assert: wrapping the filesystem changes nothing here. The
     * wrapper still matters for reads that do not go through the App (`DocumentsLocator`
     * resolves candidate paths by `stat`), which is why the wrapped arm stays.
     */
    it('sees the in-editor buffer whether or not the filesystem is document-backed', async () => {
      for (const filesystem of [fs, new DocumentBackedFileSystem(fs, documentManager)]) {
        connection.sendDiagnostics.mockClear();
        runChecks = makeRunChecksWithFs(filesystem);

        await runChecks([callerURI]);

        expect(connection.sendDiagnostics).toHaveBeenCalledWith({
          uri: callerURI,
          version: 0,
          diagnostics: [],
        });
      }
    });

    /**
     * THE CONTROL for both, and the reason `unknownArgDiagnostic` still exists. Both arms
     * above now assert SILENCE, so on their own they would pass just as well against a check
     * that had stopped reporting anything at all, or a fixture whose caller passed nothing.
     * Here the buffer is the on-disk text — the partial references `arg` in neither — and the
     * offense is still reported, so the silence above is the buffer's doing.
     */
    it('still reports an argument no version of the partial references', async () => {
      documentManager.open(partialURI, partialOnDisk, 0);
      runChecks = makeRunChecksWithFs(new DocumentBackedFileSystem(fs, documentManager));

      await runChecks([callerURI]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [unknownArgDiagnostic],
      });
    });
  });
  describe('publishing across the app', () => {
    /**
     * A run triggered by one file still visits every file in the app and still
     * publishes for each one, so an offense that no longer exists is cleared rather
     * than left on screen.
     */
    const aUri = path.join(rootUri, 'app', 'views', 'pages', 'a.liquid');
    const bUri = path.join(rootUri, 'app', 'views', 'pages', 'b.liquid');

    function makeRunChecksWithFs(
      fileSystem: MockFileSystem,
      checks: LiquidCheckDefinition[] | typeof allChecks,
    ) {
      return makeRunChecks(documentManager, diagnosticsManager, {
        fs: fileSystem,
        loadConfig: async () => ({ settings: {}, checks, rootUri }),
        platformosDocset: {
          graphQL: async () => null,
          filters: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          tags: async () => [],
        },
        jsonValidationSet: {
          schemas: async () => [],
        },
      });
    }

    beforeEach(() => {
      fs = new MockFileSystem(
        {
          '.pos': '',
          'app/views/pages/a.liquid': `{{ 'x' | filter }}`,
          'app/views/pages/b.liquid': `{{ 'y' | filter }}`,
        },
        rootUri,
      );
      runChecks = makeRunChecksWithFs(fs, [LiquidFilter]);
      documentManager.open(aUri, `{{ 'x' | filter }}`, 0);
      documentManager.open(bUri, `{{ 'y' | filter }}`, 0);
    });

    it('clears the diagnostics of a file that no longer offends after another file is edited', async () => {
      await runChecks([aUri]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ uri: bUri, diagnostics: [expect.anything()] }),
      );

      // B is fixed, A is edited. Editing A must still republish B — as empty.
      documentManager.change(bUri, 'no filters here', 1);
      documentManager.change(aUri, `{{ 'x' | filter }}{{ 'z' | filter }}`, 1);
      connection.sendDiagnostics.mockClear();

      await runChecks([aUri]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: bUri,
        version: 1,
        diagnostics: [],
      });
      expect(connection.sendDiagnostics).toHaveBeenCalledWith(
        expect.objectContaining({ uri: aUri, version: 1 }),
      );
    });
  });
  /**
   * Two ways a cross-file diagnostic can silently vanish once the workspace is
   * loaded LAZILY, both found by driving the real language server over a
   * 2700-file project rather than by a unit test. Each is pinned here with the
   * discriminator that tells the two code paths apart.
   *
   * A call site's parameters are resolved two ways, by two different checks:
   *
   *  - `UnrecognizedRenderPartialArguments` reads `{% doc %}`, which reaches the
   *    partial via `getDocDefinition` → `documentManager.get(uri)`, so it needs
   *    the partial to be a DOCUMENT;
   *  - `PartialCallArguments` INFERS them from undefined variables in the
   *    partial's source, read through `context.fs`, which always works.
   *
   * The two agree about a missing required parameter, so a test built on one
   * would pass either way. They disagree about an UNKNOWN one: `{% doc %}` is
   * the complete parameter list, so an argument it does not declare is an
   * offense — while the inference path derives the list FROM the source, so
   * every variable the partial uses is allowed and nothing is reported. That is
   * the discriminator these use, which is why they run the doc-reading check.
   */
  describe('cross-file diagnostics while the workspace is still loading', () => {
    const callerURI = path.join(rootUri, 'app', 'views', 'pages', 'home.liquid');
    const partialURI = path.join(rootUri, 'app', 'views', 'partials', 'card.liquid');
    const caller = `{% render 'card', title: 'a', legacy: 'b' %}`;
    // `legacy` is used by the partial but NOT declared in its `{% doc %}`, so it
    // is an offense with the doc and invisible without it.
    const partial = `{% doc %}\n  @param {string} title - the title\n{% enddoc %}{{ title }}{{ legacy }}`;

    const docReadingChecks = allChecks.filter(
      (c) => c.meta.code === 'UnrecognizedRenderPartialArguments',
    );

    const unknownLegacy = {
      source: 'platformos-check',
      code: 'UnrecognizedRenderPartialArguments',
      codeDescription: { href: expect.any(String) },
      message: "Unknown argument 'legacy' in render tag for partial 'card'.",
      severity: 2,
      range: {
        start: { line: 0, character: 30 },
        end: { line: 0, character: 41 },
      },
    };

    function makeRunChecksOver(fileSystem: MockFileSystem) {
      return makeRunChecks(documentManager, diagnosticsManager, {
        fs: fileSystem,
        loadConfig: async () => ({ settings: {}, checks: docReadingChecks, rootUri }),
        platformosDocset: {
          graphQL: async () => null,
          filters: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          tags: async () => [],
        },
        jsonValidationSet: { schemas: async () => [] },
        includeFilesFromDisk: () => true,
      });
    }

    /**
     * The race. `didOpen` starts `preload` in the BACKGROUND and does not await it, so
     * the first check of a session can run before the project has been read — and a
     * partial nobody has read is not a document, so its `{% doc %}` is not there to be
     * found.
     */
    it('waits for the workspace so the first check of a session sees the doc definition', async () => {
      const projectFs = new MockFileSystem(
        {
          '.pos': '',
          'app/views/pages/home.liquid': caller,
          'app/views/partials/card.liquid': partial,
        },
        rootUri,
      );
      documentManager = new DocumentManager(projectFs);
      runChecks = makeRunChecksOver(projectFs);

      // Exactly what `didOpen` does: record the buffer, check it. Nothing here
      // has awaited the workspace.
      documentManager.open(callerURI, caller, 0);
      await runChecks([callerURI]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [unknownLegacy],
      });
    });

    /**
     * The file the workspace could not read. `preload` logs it and carries on,
     * so it stays in the `App` — classified, with no contents — and
     * `AppFile.source` THROWS rather than pretending to be `''`.
     *
     * Handing that file out as a document would cost the whole run — `check` reads `ast`
     * for every file it visits — so ONE unreadable file would mean no diagnostics for
     * anything.
     */
    it('an unreadable file costs its own diagnostics and nothing else', async () => {
      const unreadableURI = path.join(rootUri, 'app', 'views', 'partials', 'locked.liquid');
      const projectFs = new MockFileSystem(
        {
          '.pos': '',
          'app/views/pages/home.liquid': caller,
          'app/views/partials/card.liquid': partial,
          'app/views/partials/locked.liquid': 'unreadable',
        },
        rootUri,
      );
      const readFile = projectFs.readFile.bind(projectFs);
      vi.spyOn(projectFs, 'readFile').mockImplementation(async (uri) => {
        if (uri === unreadableURI) throw new Error('EACCES: permission denied');
        return readFile(uri);
      });
      documentManager = new DocumentManager(projectFs);
      runChecks = makeRunChecksOver(projectFs);

      documentManager.open(callerURI, caller, 0);
      await runChecks([callerURI]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [unknownLegacy],
      });
      // It is in the app, so nothing pretends it is not there — but it is not a
      // document, so it is never published for and never read.
      expect(documentManager.appModel(rootUri).has(unreadableURI)).toBe(true);
      expect(documentManager.get(unreadableURI)).toBe(undefined);
      expect(connection.sendDiagnostics).not.toHaveBeenCalledWith(
        expect.objectContaining({ uri: unreadableURI }),
      );
    });
  });

  /**
   * The editor gets the same App the CLI does. Without it every `DocumentsLocator` in
   * every check falls back to walking candidate paths with a `stat` each, and
   * `context.fileType` re-derives a type the file already classified — in the one place
   * where that latency is visible to a person.
   */
  describe('the run gets the App itself, not just the open documents', () => {
    const callerURI = path.join(rootUri, 'app', 'views', 'pages', 'home.liquid');
    const partialURI = path.join(rootUri, 'app', 'views', 'partials', 'card.liquid');

    /**
     * Reports what `context.app` resolves a name to, so what gets pinned is what a check
     * actually receives rather than an internal of `check()`.
     */
    const AppProbe: LiquidCheckDefinition = {
      meta: {
        code: 'AppProbe',
        name: 'Reports what context.app resolves',
        docs: { description: 'Reports what context.app resolves', recommended: true },
        type: SourceCodeType.LiquidHtml,
        severity: Severity.ERROR,
        schema: {},
        targets: [],
      },
      create(context) {
        return {
          async onCodePathEnd() {
            context.report({
              message: `app=${context.app.find(PlatformOSFileType.Partial, 'card')?.uri}`,
              startIndex: 0,
              endIndex: 1,
            });
          },
        };
      },
    };

    function projectWith(source: string) {
      return new MockFileSystem(
        {
          '.pos': '',
          'app/views/pages/home.liquid': source,
          'app/views/partials/card.liquid': `{{ 'card' }}`,
        },
        rootUri,
      );
    }

    function runChecksOver(
      fileSystem: MockFileSystem,
      checks: CheckDefinition[],
      getRouteTable?: () => RouteTable | undefined,
    ) {
      return makeRunChecks(documentManager, diagnosticsManager, {
        fs: fileSystem,
        loadConfig: async () => ({ settings: {}, checks, rootUri }),
        platformosDocset: {
          graphQL: async () => null,
          filters: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          tags: async () => [],
        },
        jsonValidationSet: { schemas: async () => [] },
        getRouteTable,
      });
    }

    it('hands the run its App, so a partial resolves through the name index', async () => {
      const projectFs = projectWith(`{{ 'home' }}`);
      documentManager = new DocumentManager(projectFs);
      runChecks = runChecksOver(projectFs, [AppProbe]);

      documentManager.open(callerURI, `{{ 'home' }}`, 0);
      await runChecks([callerURI]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [
          {
            source: 'platformos-check',
            code: 'AppProbe',
            message: `app=${partialURI}`,
            severity: 1,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      });
    });

    it('hands the run the editor route table as a provider: same instance, built on first use', async () => {
      const projectFs = projectWith(`{{ 'home' }}`);
      documentManager = new DocumentManager(projectFs);
      const editorTable = new RouteTable(projectFs);

      // `Dependencies.routeTable` is a provider that OWNS its table's currency, so
      // build-on-first-use lives in runChecks' wrapper — and the table a check receives
      // must still be THE editor table, not a second one built behind its back.
      const RouteTableProbe: LiquidCheckDefinition = {
        meta: {
          code: 'RouteTableProbe',
          name: 'Reports what context.getRouteTable resolves',
          docs: { description: 'Reports what context.getRouteTable resolves', recommended: true },
          type: SourceCodeType.LiquidHtml,
          severity: Severity.ERROR,
          schema: {},
          targets: [],
        },
        create(context) {
          return {
            async onCodePathEnd() {
              const table = await context.getRouteTable();
              context.report({
                message: `same=${table === editorTable} built=${table.isBuilt()}`,
                startIndex: 0,
                endIndex: 1,
              });
            },
          };
        },
      };

      runChecks = runChecksOver(projectFs, [RouteTableProbe], () => editorTable);

      documentManager.open(callerURI, `{{ 'home' }}`, 0);
      await runChecks([callerURI]);

      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [
          {
            source: 'platformos-check',
            code: 'RouteTableProbe',
            message: 'same=true built=true',
            severity: 1,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        ],
      });
    });

    it('resolves an indexed partial with no I/O, and still hits the filesystem for one the app lacks', async () => {
      const source = `{% render 'card' %}{% render 'ghost' %}`;
      const projectFs = projectWith(source);

      const statted: string[] = [];
      const stat = projectFs.stat.bind(projectFs);
      vi.spyOn(projectFs, 'stat').mockImplementation(async (uri) => {
        statted.push(uri);
        return stat(uri);
      });
      const listed: string[] = [];
      const readDirectory = projectFs.readDirectory.bind(projectFs);
      vi.spyOn(projectFs, 'readDirectory').mockImplementation(async (uri) => {
        listed.push(uri);
        return readDirectory(uri);
      });

      documentManager = new DocumentManager(projectFs);
      runChecks = runChecksOver(
        projectFs,
        allChecks.filter((check) => check.meta.code === 'MissingPartial'),
      );

      await documentManager.preload(rootUri);
      // The preload walk is not what this measures.
      statted.length = 0;
      listed.length = 0;

      documentManager.open(callerURI, source, 0);
      await runChecks([callerURI]);

      const candidatesFor = (name: string) =>
        nameToPaths(PlatformOSFileType.Partial, name).map((candidate) =>
          path.join(rootUri, candidate),
        );
      const candidateDirs = [
        path.join(rootUri, 'app/views/partials'),
        path.join(rootUri, 'app/lib'),
      ];

      // In the app: answered by `App.find`, so not one candidate spelling is probed.
      expect(statted.filter((uri) => candidatesFor('card').includes(uri))).toEqual([]);
      expect(statted.filter((uri) => candidatesFor('ghost').includes(uri))).toEqual([]);
      // Not in the app: the filesystem miss path is still the fallback — one
      // listing per candidate DIRECTORY, not a stat per spelling. Only 'ghost'
      // takes it ('card' answered from the index), so these listings are its.
      // Without this the assertions above would also pass with a broken spy.
      expect(listed.filter((uri) => candidateDirs.includes(uri))).toEqual(candidateDirs);
      expect(connection.sendDiagnostics).toHaveBeenCalledWith({
        uri: callerURI,
        version: 0,
        diagnostics: [
          {
            source: 'platformos-check',
            code: 'MissingPartial',
            codeDescription: {
              href: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-partial',
            },
            message: `'ghost' does not exist`,
            severity: 1,
            range: { start: { line: 0, character: 29 }, end: { line: 0, character: 36 } },
          },
        ],
      });
    });

    /**
     * Handing over the model widens what the checks can SEE. It must not widen what
     * they VISIT — that is what `only` is for.
     *
     * Asserted on the files the check ran over rather than on the diagnostics that
     * came out, because those are published per open buffer either way: dropping
     * `only` would silently read, parse and check every file in the project on every
     * keystroke and produce identical diagnostics while doing it.
     */
    it('visits the open buffers only, though the whole app is visible', async () => {
      const visited: string[] = [];
      const VisitRecorder: LiquidCheckDefinition = {
        meta: {
          code: 'VisitRecorder',
          name: 'Records the files it was run over',
          docs: { description: 'Records the files it was run over', recommended: true },
          type: SourceCodeType.LiquidHtml,
          severity: Severity.ERROR,
          schema: {},
          targets: [],
        },
        create(context) {
          return {
            async onCodePathStart(file) {
              visited.push(file.uri);
              // The app has to be visible from the file that IS visited, or this
              // would also pass for a run that saw nothing at all.
              expect(context.app.find(PlatformOSFileType.Partial, 'card')?.uri).toBe(partialURI);
            },
          };
        },
      };

      const projectFs = projectWith(`{{ 'home' }}`);
      documentManager = new DocumentManager(projectFs);
      runChecks = runChecksOver(projectFs, [VisitRecorder]);

      await documentManager.preload(rootUri);
      documentManager.open(callerURI, `{{ 'home' }}`, 0);
      await runChecks([callerURI]);

      // Both files are in the app and both are readable; only the buffer is visited.
      expect(
        documentManager
          .appModel(rootUri)
          .sourceCodes()
          .map((file) => file.uri),
      ).toEqual([callerURI, partialURI]);
      expect(visited).toEqual([callerURI]);
      expect(connection.sendDiagnostics.mock.calls.map(([params]: any[]) => params.uri)).toEqual([
        callerURI,
      ]);
    });
  });
});
