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
 * The file types the GRAPH holds and the linter does not: `.js` assets and images.
 *
 * They exist for {@link toSourceCode}'s contract — every URI it is handed comes back as a
 * `FileSourceCode` — and so an `App` an asset URI is put into can answer `ast` at all. NOT
 * because a graph build reads them: `traverseModule` returns immediately for an Asset node, and
 * the only question the graph asks about an asset is whether it EXISTS.
 *
 * Registering them on an {@link App} — rather than building a second set of file objects — is
 * what lets a graph build and a lint run over the same project hold the SAME `AppFile`
 * instances, so each file is read and parsed at most once for both. The language server does
 * that; check-node builds no graph, so merging into `nodeParsers` would do nothing.
 *
 * THE MCP SUPERVISOR DELIBERATELY DOES NOT SHARE, and this is not a pending to-do: it builds no
 * graph, parsing per request only the handful of files that could reference the edited one.
 * Routing those through check-node's shared `App` would win nothing — `lintBuffers` parses the
 * content it was HANDED and drops the app's entry on the way out — and would risk something,
 * because that `App` carries UNSAVED buffers while the blast radius runs CONCURRENTLY with the
 * lint.
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
