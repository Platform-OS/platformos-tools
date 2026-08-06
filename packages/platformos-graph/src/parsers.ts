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
 * They are here for {@link toSourceCode}'s contract — every URI it is handed comes back
 * as a `FileSourceCode`, so an asset needs a row that says how (or that there is nothing
 * to parse) — and so an `App` an asset URI is put into can answer `ast` at all. NOT
 * because a graph build reads them: `traverseModule` returns immediately for an Asset
 * node, and the only question the graph asks about an asset is whether it EXISTS, which
 * is an `fs` probe. So a project model built with `sourceParsers` alone is enough to back
 * a graph — every file the graph reads is a Liquid, GraphQL or YAML one.
 *
 * Registering them on an {@link App} — rather than building a second set of file
 * objects — is what lets a graph build and a lint run over the same project hold the
 * SAME `AppFile` instances, so each file is read and parsed at most once for both.
 * The language server does that: it merges this map into its own
 * (`languageServerParsers`) and its `AppGraphManager` reads through
 * {@link appBackedGetSourceCode}. Merging into check-node's `nodeParsers` would do
 * nothing: check-node builds no graph.
 *
 * THE MCP SUPERVISOR DELIBERATELY DOES NOT SHARE, and this is not a pending to-do:
 *
 * - Its full builds run on a worker thread — a second heap on purpose, so a
 *   whole-project parse cannot be retained by the process serving lints — and a thread
 *   cannot share `AppFile` objects at all.
 * - Its incremental `applyFileChange` does run in the main process, but its graph cache
 *   is an authority on DISK state: a fingerprint that matches means "this graph
 *   describes these bytes". check-node's shared `App` is lint-owned and carries UNSAVED
 *   editor buffers (`lintBuffers` overlays each buffer under `BUFFER_VERSION` and
 *   reverts when the call ends), and the cache reconciles in the BACKGROUND, concurrent
 *   with lints. Reading a graph through it could record a buffer as disk truth in a
 *   graph whose fingerprint then declares it fresh — a wrong answer no later scan
 *   invalidates, which is the one failure that cache exists to rule out.
 * - And there would be nothing to win. `lintBuffers` parses the content it was handed,
 *   never the app's copy of that file, and drops the app's entry for it on the way out
 *   — so the file a reconcile parses is precisely the file whose parse no lint would
 *   have reused.
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
