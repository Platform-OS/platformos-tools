/**
 * The project's edge-source files as TEXT, read ONCE per request.
 *
 * This is the whole of impact's project state, and it is read only when the edited buffer
 * declares a `{% doc %}` contract worth comparing callers against. The trade is deliberate:
 * pay a project READ per request — I/O, on the threadpool, overlapping the lint's CPU —
 * instead of a whole-project PARSE once and a lifetime of keeping it honest. Measured on a
 * real project (2,615 edge sources, 3.0 MB): 235 ms. Being derived per request, it cannot be
 * stale, which is why `impact` has no `computing` state.
 *
 * SCOPE. Only EDGE SOURCES are read (`enumerateEdgeSources` — page/layout/partial), because
 * only their content can declare an edge; `.graphql`/`.yml`/asset files are leaves and can
 * never be the SOURCE of a reference. That is the graph's own definition, imported rather
 * than restated.
 *
 * BUFFERS WIN OVER DISK. The changeset under validation is overlaid, so a call a buffer has
 * only just added counts, and one it has just deleted stops counting — otherwise this stage
 * would answer from disk while the lint beside it answers from the buffer. A buffer for a
 * file not yet on disk is ADDED when it is an edge source, so a brand-new page's
 * `{% render %}` is seen.
 */
import { path, type UriString } from '@platformos/platformos-check-common';
import type { AbstractFileSystem } from '@platformos/platformos-common';
import { enumerateEdgeSources, isEdgeSource } from '@platformos/platformos-graph';

/** The project text one request works from, plus the filesystem name resolution reads through. */
export interface ProjectScan {
  readonly rootUri: UriString;
  readonly fs: AbstractFileSystem;
  /** Every edge source's text, keyed by normalized URI. Memoized: read once per scan. */
  sources(): Promise<ReadonlyMap<UriString, string>>;
}

/**
 * A scan of `rootUri`, with `buffers` (normalized URI → in-flight content) overlaid.
 *
 * Nothing is read until {@link ProjectScan.sources} is first called, and it is read exactly
 * once however many buffers a request validates — the reason the scan is a request-scoped
 * object rather than a free function.
 */
export function createProjectScan(
  rootUri: UriString,
  fs: AbstractFileSystem,
  buffers: ReadonlyMap<UriString, string> = new Map(),
): ProjectScan {
  let pending: Promise<ReadonlyMap<UriString, string>> | undefined;
  return {
    rootUri,
    fs,
    sources: () => (pending ??= readEdgeSources(rootUri, fs, buffers)),
  };
}

async function readEdgeSources(
  rootUri: UriString,
  fs: AbstractFileSystem,
  buffers: ReadonlyMap<UriString, string>,
): Promise<ReadonlyMap<UriString, string>> {
  const uris = await enumerateEdgeSources(fs, rootUri);
  const sources = new Map<UriString, string>();

  await Promise.all(
    uris.map(async (uri) => {
      const key = path.normalize(uri);
      // The buffer is the truth for this file; reading it would race the overlay below.
      if (buffers.has(key)) return;
      // A file that vanished between the walk and the read cannot be a dependent, and
      // failing the whole scan over it would cost the answer for every other file.
      const source = await fs.readFile(uri).catch(() => undefined);
      if (source !== undefined) sources.set(key, source);
    }),
  );

  for (const [uri, source] of buffers) {
    // A buffer that is not an edge source (a `.graphql` operation, a schema `.yml`)
    // declares no outgoing edges, so it can only be a target — nothing to scan.
    if (isEdgeSource(uri, rootUri)) sources.set(uri, source);
  }

  return sources;
}
