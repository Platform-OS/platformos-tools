/**
 * Dependency-graph path resolvers.
 *
 * `project-fact-graph` calls these when it walks the project map to add
 * file → file edges. The full graph + orphan detection from the source
 * module are out of v1 scope (only consumed by `analyze-project`); only
 * the three path resolvers survive.
 *
 * Each resolver returns a canonical repo-relative path
 * (`app/views/partials/x.liquid`, `app/lib/commands/x/y.liquid`,
 * `app/graphql/x/y.graphql`). Module references (`modules/<name>/…`) are
 * resolved to the module file under `modules/` so consumers can still
 * walk them — they just won't appear in the internal project's file list.
 */

import type { ProjectMap } from './project-scanner';

/**
 * Resolve a `{% render %}` name to the canonical partial path.
 *
 * Honours relative names by resolving against the caller's directory under
 * `app/views/partials/`. A partial at `app/views/partials/blog_posts/new.liquid`
 * that does `{% render 'form' %}` resolves to `blog_posts/form`, matching
 * the key the scanner stores.
 */
export function resolveRenderTarget(
  name: string | null | undefined,
  projectMap: ProjectMap | null | undefined,
  callerPath?: string,
): string | null {
  if (!name) return null;
  if (name.startsWith('modules/')) return `modules/${name.replace(/^modules\//, '')}.liquid`;

  const resolved = resolveRelativeRenderName(callerPath, name);

  const partial = projectMap?.partials?.[resolved];
  if (partial?.path) return partial.path;

  // Fallback: assume the standard location. May produce a non-existent
  // path when the render name is wrong — orphan detection treats that as
  // an edge into a missing file (surfaced as `broken_render` by the
  // out-of-scope integrity checks).
  return `app/views/partials/${resolved}.liquid`;
}

/**
 * Resolve a `{% function _ = 'path' %}` call to its on-disk file.
 * Commands and queries live under `app/lib/` with a `.liquid` extension.
 */
export function resolveFunctionTarget(fcPath: string | null | undefined): string | null {
  if (!fcPath) return null;
  if (fcPath.startsWith('modules/')) {
    return `modules/${fcPath.replace(/^modules\//, '')}.liquid`;
  }
  return `app/lib/${fcPath}.liquid`;
}

/**
 * Resolve a `{% graphql %}` operation name to its on-disk file.
 */
export function resolveGraphqlTarget(opName: string | null | undefined): string | null {
  if (!opName) return null;
  if (opName.startsWith('modules/')) {
    return `modules/${opName.replace(/^modules\//, '')}.graphql`;
  }
  return `app/graphql/${opName}.graphql`;
}

/**
 * Minimal in-module copy of `project-scanner`'s `resolveRenderName`.
 *
 * Duplicated here (rather than imported) to keep this module a leaf in the
 * dependency graph — `project-scanner` already imports from `liquid-parser`
 * and `domain-detector`, and a back-edge into `dependency-graph` would
 * introduce a cycle that the source repo took the same care to avoid.
 * Keep both implementations in sync.
 */
function resolveRelativeRenderName(callerRelPath: string | undefined, renderName: string): string {
  if (!renderName) return renderName;
  if (renderName.includes('/')) return renderName;
  if (!callerRelPath) return renderName;

  const partialsPrefix = 'app/views/partials/';
  if (!callerRelPath.startsWith(partialsPrefix)) return renderName;

  const relUnderPartials = callerRelPath
    .slice(partialsPrefix.length)
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  const slashIdx = relUnderPartials.lastIndexOf('/');
  if (slashIdx < 0) return renderName;
  const dir = relUnderPartials.slice(0, slashIdx);
  return `${dir}/${renderName}`;
}
