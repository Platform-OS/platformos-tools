import {
  isLayout,
  isPage,
  isPartial,
  path,
  recursiveReadDirectory,
  type UriString,
} from '@platformos/platformos-check-common';
import type { AbstractFileSystem } from '@platformos/platformos-common';

/**
 * The canonical definition of an EDGE SOURCE: a liquid file whose own content
 * can declare outgoing edges (a Page, Layout, or Partial). Only these files'
 * add/remove/modify can change any file's set of dependents — `.graphql`/`.yml`/
 * asset files are leaves. This is exactly the set a caller feeds `buildAppGraph`
 * as entry points when it needs COMPLETE dependents (every caller traversed).
 *
 * "Which files" derives entirely from the file-type classifier
 * (`isLayout`/`isPage`/`isPartial` ← `FILE_TYPE_DIRS`), so there is ONE source of
 * truth for the classification — this predicate never re-encodes it.
 */
export function isEdgeSource(uri: UriString): boolean {
  return isLayout(uri) || isPage(uri) || isPartial(uri);
}

/**
 * The top-level platformOS source roots that can contain an edge-source liquid
 * file. Per the file-type classifier, every Page/Layout/Partial lives under the
 * modern `app/` root (which also holds `app/modules/<m>/…`), the legacy
 * `marketplace_builder/` alias, or a top-level `modules/<m>/…`. Scoping the walk
 * to these — instead of the whole project tree — skips large non-platformOS
 * siblings (e.g. a bundled `react-app/`) with NO loss of real sources.
 *
 * This is a scoping OPTIMISATION, not a second classification: `edge-sources.spec`
 * pins the scoped result to a whole-tree walk filtered by {@link isEdgeSource},
 * so a source root added to the classifier but not here fails the test.
 */
const SOURCE_ROOTS = ['app', 'marketplace_builder', 'modules'] as const;

/**
 * Enumerate every edge-source liquid file under a project root — the single
 * canonical primitive for "which files are the graph's edge sources / entry
 * points / fingerprint domain" (TASK-9.17). Consumers (the supervisor's
 * GraphCache) are pure users: they never re-derive the source-root set or the
 * `isEdgeSource` predicate.
 *
 * The walk is SCOPED to {@link SOURCE_ROOTS} (the TASK-9.15 Phase-3A perf win): a
 * root absent on disk contributes nothing (`recursiveReadDirectory` returns `[]`
 * on ENOENT); the roots are disjoint, so no URI is produced twice.
 *
 * NOT shared with `buildAppGraph`'s full-build discovery (AC#5, evaluated and
 * declined): that walk gathers a DIFFERENT domain — render *entry points*
 * (pages + layouts only; partials are edge-reached) plus standalone schema
 * nodes — over the WHOLE tree, whereas this gathers page + layout + partial
 * (the cache needs partials as entry points for a complete reverse index) and is
 * scoped. The two share the `isLayout`/`isPage`/`isPartial` predicate (the single
 * classifier), which is the part that must not drift; sharing the walk itself
 * would conflate two different entry-point domains.
 */
export async function enumerateEdgeSources(
  fs: AbstractFileSystem,
  rootUri: UriString,
): Promise<UriString[]> {
  const perRoot = await Promise.all(
    SOURCE_ROOTS.map((dir) =>
      recursiveReadDirectory(fs, path.join(rootUri, dir), ([uri]) => isEdgeSource(uri)),
    ),
  );
  return perRoot.flat();
}
