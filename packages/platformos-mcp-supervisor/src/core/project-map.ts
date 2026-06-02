/**
 * Project-map cache.
 *
 * Source originally lived inside `tools/project-map.js` (the MCP tool) and
 * was re-exported as `getProjectMap` for in-process consumers like
 * `validate-code`. v1 drops the tool but keeps the cache — `validate-code`
 * calls `getProjectMap` four times per invocation (sections 2d, 2e, 12a,
 * and the new-partial caller check) and rescanning the project each time
 * would be wasteful.
 *
 * TTL is 30 s (see `constants.PROJECT_MAP_CACHE_TTL_MS`). The
 * `invalidateProjectMap` export from source was driven by the fs-watcher
 * subsystem (out of scope) — dropped. Callers that need a fresh scan pass
 * `{ forceRefresh: true }`.
 */

import { PROJECT_MAP_CACHE_TTL_MS } from './constants';
import { scanProject, type ProjectMap } from './project-scanner';

export interface GetProjectMapOptions {
  forceRefresh?: boolean;
}

let _cache: ProjectMap | null = null;
let _cacheTime = 0;
let _cacheDir: string | null = null;

/**
 * Return the cached `ProjectMap` for `projectDir`, scanning fresh when the
 * cache is empty, expired, or scoped to a different project directory.
 */
export async function getProjectMap(
  projectDir: string,
  { forceRefresh = false }: GetProjectMapOptions = {},
): Promise<ProjectMap> {
  const now = Date.now();
  if (
    !forceRefresh &&
    _cache &&
    _cacheDir === projectDir &&
    now - _cacheTime < PROJECT_MAP_CACHE_TTL_MS
  ) {
    return _cache;
  }
  _cache = await scanProject(projectDir);
  _cacheTime = Date.now();
  _cacheDir = projectDir;
  return _cache;
}

/** Reset the cached map. Test seam — not wired into production code. */
export function _resetProjectMapCache(): void {
  _cache = null;
  _cacheTime = 0;
  _cacheDir = null;
}
