import { type UriString } from '@platformos/platformos-check-common';
import {
  getFileType,
  PlatformOSFileType,
  walkAppSourceFiles,
  type AbstractFileSystem,
} from '@platformos/platformos-common';

/**
 * The canonical definition of an EDGE SOURCE: a liquid file whose own content
 * can declare outgoing edges (a Page, Layout, or Partial). Only these files'
 * add/remove/modify can change any file's set of dependents — `.graphql`/`.yml`/
 * asset files are leaves. This is exactly the set a caller feeds `buildAppGraph`
 * as entry points when it needs COMPLETE dependents (every caller traversed).
 *
 * "Which files" derives entirely from the file-type classifier
 * (`getFileType` ← `FILE_TYPE_DIRS`), so there is ONE source of truth for the
 * classification — this predicate never re-encodes it.
 *
 * Classification is ANCHORED on `rootUri`, because a file's type IS its position
 * relative to the project root: unanchored, `tmp/app/lib/x.liquid` is a Partial
 * and `seed/app/views/pages/x.liquid` is a Page, so the fingerprint domain grew
 * files the app does not contain.
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
 * Enumerate every edge-source liquid file under a project root — the single
 * canonical primitive for "which files are the graph's edge sources / entry
 * points / fingerprint domain" (TASK-9.17). Consumers (the supervisor's
 * GraphCache) are pure users: they never re-derive the walk or the
 * `isEdgeSource` predicate.
 *
 * The walk is `walkAppSourceFiles` — platformos-common's anchored expansion of
 * `APP_SOURCE_SUBTREES`. That is where the knowledge of which subtrees can hold an
 * app file lives, so this file names no directory at all; it also keeps the
 * TASK-9.15 Phase-3A scoping win (a bundled `react-app/` is never walked) without
 * a second root list to drift from the classifier. `edge-sources.spec` pins the
 * scoped result to a whole-tree walk filtered by {@link isEdgeSource}, so a
 * subtree the classifier admits but the walk misses fails the test.
 *
 * NOT shared with `buildAppGraph`'s full-build discovery (AC#5, evaluated and
 * declined): the two gather DIFFERENT domains — that one takes render *entry
 * points* (pages + layouts only; partials are edge-reached) plus standalone schema
 * nodes, this one takes page + layout + partial (the cache needs partials as entry
 * points for a complete reverse index). They now share both the walk primitive and
 * the classifier, which are the parts that must not drift; the domains stay
 * distinct because each passes its own filter.
 */
export async function enumerateEdgeSources(
  fs: AbstractFileSystem,
  rootUri: UriString,
): Promise<UriString[]> {
  return walkAppSourceFiles(fs, rootUri, ([uri]) => isEdgeSource(uri, rootUri));
}
