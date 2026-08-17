import { type UriString } from '@platformos/platformos-check-common';
import {
  getFileType,
  PlatformOSFileType,
  walkAppSourceFiles,
  type AbstractFileSystem,
} from '@platformos/platformos-common';

/**
 * The canonical definition of an EDGE SOURCE: a liquid file whose own content can declare
 * outgoing edges (a Page, Layout, or Partial). Only these files' add/remove/modify can change
 * any file's set of dependents — `.graphql`/`.yml`/asset files are leaves.
 *
 * "Which files" derives entirely from the file-type classifier, so this predicate never
 * re-encodes the classification. It is ANCHORED on `rootUri`, because a file's type IS its
 * position relative to the project root: unanchored, `tmp/app/lib/x.liquid` is a Partial.
 */
export function isEdgeSource(uri: UriString, rootUri: UriString): boolean {
  switch (getFileType(uri, rootUri)) {
    case PlatformOSFileType.Layout:
    case PlatformOSFileType.Page:
    case PlatformOSFileType.Partial:
      return true;
    default:
      return false;
  }
}

/**
 * Enumerate every edge-source liquid file under a project root — the single canonical primitive
 * for "which files are the graph's edge sources". Consumers never re-derive the walk or the
 * {@link isEdgeSource} predicate.
 *
 * The walk is `walkAppSourceFiles`, platformos-common's anchored expansion of
 * `APP_SOURCE_SUBTREES`, so this file names no directory at all and a bundled `react-app/` is
 * never walked. `edge-sources.spec` pins the scoped result against a whole-tree walk filtered
 * by {@link isEdgeSource}.
 *
 * NOT shared with `buildAppGraph`'s full-build discovery: the two gather DIFFERENT domains —
 * that one takes render entry points (pages + layouts, partials being edge-reached) plus
 * standalone schema nodes, this one takes page + layout + partial. They share the walk
 * primitive and the classifier, which are the parts that must not drift.
 */
export async function enumerateEdgeSources(
  fs: AbstractFileSystem,
  rootUri: UriString,
): Promise<UriString[]> {
  return walkAppSourceFiles(fs, rootUri, ([uri]) => isEdgeSource(uri, rootUri));
}
