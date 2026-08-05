import { App, AppFile, Parser, Parsers, UriString } from '@platformos/platformos-common';
import { asError } from '@platformos/platformos-check-common';
import { parse as acornParse, Program } from 'acorn';

import { FileSourceCode, SUPPORTED_ASSET_IMAGE_EXTENSIONS } from './types';

/** Parse a JavaScript asset, capturing a syntax error as a value rather than throwing. */
export function parseJs(source: string): Program | Error {
  try {
    return acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (error) {
    return asError(error);
  }
}

/**
 * A binary asset has nothing to parse. It is still a graph node — something links
 * to it — so it gets an `Error` value rather than being absent, exactly as an
 * unparseable file would.
 */
const parseOpaqueAsset: Parser = () => new Error('File parsing not implemented');

/**
 * The file types the GRAPH cares about and the linter does not: `.js` assets, and
 * images it only needs to know the existence of.
 *
 * {@link toSourceCode} parses assets through this map, so there is one definition of
 * how a `.js` or image asset is handled however the file arrives.
 *
 * Registering these on an {@link App} — rather than building a second set of file
 * objects — is what lets a graph build and a lint run over the same project hold the
 * SAME `AppFile` instances, so each file is read and parsed at most once for both.
 * The language server does that: it merges this map into its own
 * (`languageServerParsers`) and its `AppGraphManager` reads through
 * {@link appBackedGetSourceCode}. The MCP supervisor is the other consumer-to-be,
 * once its lint adapter grows a graph. Merging into check-node's
 * `nodeParsers` would do nothing: check-node builds no graph.
 */
export const graphParsers: Parsers = {
  extensions: {
    js: parseJs,
    ...Object.fromEntries(
      SUPPORTED_ASSET_IMAGE_EXTENSIONS.map((extension) => [extension, parseOpaqueAsset]),
    ),
  },
};

/**
 * A `getSourceCode` for the graph backed by an {@link App}.
 *
 * Pass it as `IDependencies.getSourceCode` and the graph stops parsing anything the
 * lint has already parsed, and vice versa — they read the same file objects. Files
 * the app does not contain fall through to `fallback`, which is how a URI outside
 * the project (or an unclassified file) still gets a source code.
 */
export function appBackedGetSourceCode(
  app: App,
  fallback: (uri: UriString) => Promise<FileSourceCode>,
): (uri: UriString) => Promise<FileSourceCode> {
  return async (uri: UriString): Promise<FileSourceCode> => {
    const file: AppFile | undefined = app.get(uri);
    if (!file) return fallback(uri);
    await file.load();
    // An AppFile is structurally a SourceCode; its `ast` is typed `unknown` only
    // because platformos-common sits below the parsers that produce ASTs.
    return file as unknown as FileSourceCode;
  };
}
