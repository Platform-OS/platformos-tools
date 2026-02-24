import {
  allChecks,
  LiquidCheckDefinition,
  path,
  Severity,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from 'vscode-languageserver';
import { DocumentManager } from '../documents';
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
      [defaultPath]: 'en:\n  hello: hello',
      [frPath]: 'fr:\n  hello: bonjour\n  hi: salut',
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
              // 'fr:\n  hello: bonjour\n  hi: salut'
              // line 2 starts at offset 21, 'hi: salut' spans offsets 23-31
              start: { line: 2, character: 2 },
              end: { line: 2, character: 10 },
            },
          },
        ]),
      }),
    );

    // Change the contents of the defaultURI buffer, expect frURI to be fixed
    documentManager.open(defaultURI, files[defaultPath], 0);
    documentManager.change(defaultURI, 'en:\n  hello: hello\n  hi: hi', 1);
    connection.sendDiagnostics.mockClear();
    await runChecks([frURI]);
    expect(connection.sendDiagnostics).toHaveBeenCalledWith({
      uri: frURI,
      version: 0,
      diagnostics: [],
    });
  });
});
