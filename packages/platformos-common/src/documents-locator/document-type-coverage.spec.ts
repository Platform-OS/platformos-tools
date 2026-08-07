import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URI } from 'vscode-uri';
import { DocumentsLocator, DocumentType } from './DocumentsLocator';
import { AbstractFileSystem, FileType } from '../AbstractFileSystem';

/**
 * Every reference kind must have an answer, and adding one must be impossible to do
 * halfway.
 *
 * This replaces a pair of `switch`es that were exhaustive over `DocumentType` AND
 * carried a `default: return undefined`. That combination is the worst of both: the
 * default looks like dead code, so it invites deletion, while actually being the thing
 * that stops a NEW `DocumentType` from silently resolving to nothing — a switch with a
 * default never fails to compile when a union member is added.
 *
 * The exhaustiveness now lives in two `Record<DocumentType, …>` tables, which do fail to
 * compile, and the runtime fallback is an explicit `isDocumentType` check that exists
 * for a reason the types cannot express (see below).
 */
describe('DocumentsLocator: every DocumentType is accounted for', () => {
  const rootUri = URI.parse('file:///project');

  const emptyFs: AbstractFileSystem = {
    stat: async () => {
      throw new Error('not found');
    },
    readFile: async () => {
      throw new Error('not found');
    },
    readDirectory: async () => [],
  };

  /**
   * Listed here rather than derived from the source, deliberately: a list generated from
   * the same table it checks would agree with itself by construction. This is the
   * independent copy, and the test below fails if the two ever diverge.
   */
  const ALL_DOCUMENT_TYPES: DocumentType[] = [
    'function',
    'render',
    'include',
    'background',
    'graphql',
    'asset',
    'layout',
    'theme_render_rc',
  ];

  it('the hand-listed DocumentTypes are exactly the ones the union declares', async () => {
    const source = await readFile(join(__dirname, 'DocumentsLocator.ts'), 'utf8');
    const union = source.slice(
      source.indexOf('export type DocumentType ='),
      source.indexOf(';', source.indexOf('export type DocumentType =')),
    );

    const declared = [...union.matchAll(/'([a-z_]+)'/g)].map(([, name]) => name);

    expect(declared.sort()).toEqual([...ALL_DOCUMENT_TYPES].sort());
  });

  it('resolves a creation path for every type except the one with no canonical location', async () => {
    const answers = ALL_DOCUMENT_TYPES.map((type) => [
      type,
      new DocumentsLocator(emptyFs).locateDefault(rootUri, type, 'thing'),
    ]);

    expect(answers).toEqual([
      ['function', 'file:///project/app/lib/thing.liquid'],
      ['render', 'file:///project/app/views/partials/thing.liquid'],
      ['include', 'file:///project/app/views/partials/thing.liquid'],
      ['background', 'file:///project/app/views/partials/thing.liquid'],
      ['graphql', 'file:///project/app/graphql/thing.graphql'],
      // An asset keeps the extension its reference carries, so nothing is appended.
      ['asset', 'file:///project/app/assets/thing'],
      ['layout', 'file:///project/app/views/layouts/thing.liquid'],
      // Several search-path prefixes are in play: no single place a new file belongs.
      ['theme_render_rc', undefined],
    ]);
  });

  /**
   * The reason `locate` keeps a runtime membership check even though its parameter is
   * typed `DocumentType`: `DocumentLinksProvider` visits every `LiquidTag` and casts
   * `node.name as DocumentType`, so an unrecognized tag genuinely arrives here. It must
   * come back unresolved rather than throw inside an LSP request handler.
   */
  it('answers an unknown tag name without throwing', async () => {
    const locator = new DocumentsLocator(emptyFs);
    const unknown = 'some_third_party_tag' as DocumentType;

    expect([
      await locator.locate(rootUri, unknown, 'thing'),
      await locator.locateOrDefault(rootUri, unknown, 'thing'),
      locator.locateDefault(rootUri, unknown, 'thing'),
      await locator.list(rootUri, 'some_third_party_tag', ''),
    ]).toEqual([undefined, undefined, undefined, []]);
  });

  /** The control for the test above: a KNOWN type must still resolve through the same calls. */
  it('still resolves a known tag name, so the guard above is not swallowing everything', async () => {
    const fs: AbstractFileSystem = {
      ...emptyFs,
      readDirectory: async (uri: string) =>
        uri === 'file:///project/app/views/partials'
          ? [['file:///project/app/views/partials/thing.liquid', FileType.File] as const]
          : [],
    };

    expect(await new DocumentsLocator(fs).locate(rootUri, 'render', 'thing')).toEqual(
      'file:///project/app/views/partials/thing.liquid',
    );
  });
});
