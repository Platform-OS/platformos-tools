/**
 * Utility functions for identifying platformOS file types based on their paths.
 *
 * Architecture:
 * - FILE_TYPE_DIRS is the single source of truth for all platformOS directory names
 * - getAppPaths() and getModulePaths() generate concrete search paths from FILE_TYPE_DIRS
 * - TYPE_MATCHERS pre-compiles regexes for fast URI classification
 * - getFileType() classifies any URI to a PlatformOSFileType
 * - isPage(), isLayout(), isPartial() etc. are convenience wrappers around getFileType()
 *
 * Pattern precision: each type uses exact path segment patterns (/app/{dir}/ or
 * /(public|private)/{dir}/) so that nested paths don't produce false positives.
 * For example, app/lib/smses/file.liquid is correctly identified as Partial
 * (matches /app/lib/), not Sms (does not match /app/smses/).
 */

import { UriString } from './AbstractFileSystem';

/**
 * File types that exist in a platformOS app, each mapping to one or more
 * canonical directory names relative to the app root or module access level.
 */
export enum PlatformOSFileType {
  Page = 'Page',
  Layout = 'Layout',
  Partial = 'Partial',
  Authorization = 'Authorization',
  Email = 'Email',
  ApiCall = 'ApiCall',
  Sms = 'Sms',
  Migration = 'Migration',
  GraphQL = 'GraphQL',
  Asset = 'Asset',
}

/**
 * The single source of truth for the platformOS directory structure.
 *
 * Maps each file type to its canonical directory name(s) relative to:
 *   - the app root:                  app/{dir}/
 *   - a module access level:         modules/{name}/(public|private)/{dir}/
 *   - a nested module access level:  app/modules/{name}/(public|private)/{dir}/
 *
 * Types with multiple dirs (e.g. Partial) will match any of their dirs.
 * The first matching type wins, so order of evaluation matters for overlapping
 * paths — but exact segment matching means dirs don't overlap in practice.
 */
export const FILE_TYPE_DIRS: Readonly<Record<PlatformOSFileType, readonly string[]>> = {
  [PlatformOSFileType.Page]: ['views/pages'],
  [PlatformOSFileType.Layout]: ['views/layouts'],
  [PlatformOSFileType.Partial]: ['views/partials', 'lib'],
  [PlatformOSFileType.Authorization]: ['authorization_policies'],
  [PlatformOSFileType.Email]: ['emails'],
  [PlatformOSFileType.ApiCall]: ['api_calls'],
  [PlatformOSFileType.Sms]: ['smses'],
  [PlatformOSFileType.Migration]: ['migrations'],
  [PlatformOSFileType.GraphQL]: ['graphql'],
  [PlatformOSFileType.Asset]: ['assets'],
};

/**
 * Liquid-containing file types. GraphQL and Asset are excluded because they
 * don't contain Liquid code and should not be passed to the Liquid linter.
 */
const LIQUID_FILE_TYPES = new Set<PlatformOSFileType>([
  PlatformOSFileType.Page,
  PlatformOSFileType.Layout,
  PlatformOSFileType.Partial,
  PlatformOSFileType.Authorization,
  PlatformOSFileType.Email,
  PlatformOSFileType.ApiCall,
  PlatformOSFileType.Sms,
  PlatformOSFileType.Migration,
]);

/**
 * Pre-compiled regex per file type, derived entirely from FILE_TYPE_DIRS.
 *
 * For each canonical dir, two pattern alternatives are generated:
 *   /app/{dir}/              — direct app-level path (e.g. /app/lib/)
 *   /(public|private)/{dir}/ — module path, covers both:
 *                                modules/{name}/(public|private)/{dir}/
 *                                app/modules/{name}/(public|private)/{dir}/
 *
 * Exact path segment matching prevents false positives:
 *   /app/lib/smses/file.liquid  → matches /app/lib/ → Partial (NOT Sms)
 *   /app/smses/file.liquid      → matches /app/smses/ → Sms (NOT Partial)
 */
const TYPE_MATCHERS = new Map<PlatformOSFileType, RegExp>(
  (Object.entries(FILE_TYPE_DIRS) as [PlatformOSFileType, readonly string[]][]).map(
    ([type, dirs]) => {
      const alternatives = dirs.flatMap((dir) => [`/app/${dir}/`, `/(public|private)/${dir}/`]);
      return [type, new RegExp(alternatives.join('|'))];
    },
  ),
);

/**
 * Returns the PlatformOSFileType for the given URI, or undefined if the URI
 * does not belong to any recognized platformOS directory.
 *
 * @example
 * getFileType('file:///root/app/lib/smses/notify.liquid') // → PlatformOSFileType.Partial
 * getFileType('file:///root/app/smses/notify.liquid')     // → PlatformOSFileType.Sms
 * getFileType('file:///root/modules/core/generators/templates/lib/create.liquid') // → undefined
 */
export function getFileType(uri: UriString): PlatformOSFileType | undefined {
  for (const [type, re] of TYPE_MATCHERS) {
    if (re.test(uri)) return type;
  }
  return undefined;
}

/**
 * Returns app-level search paths for a file type (relative to project root).
 *
 * @example
 * getAppPaths(PlatformOSFileType.Partial) // → ['app/views/partials', 'app/lib']
 * getAppPaths(PlatformOSFileType.GraphQL) // → ['app/graphql']
 */
export function getAppPaths(type: PlatformOSFileType): string[] {
  return FILE_TYPE_DIRS[type].map((dir) => `app/${dir}`);
}

/**
 * Returns all module search paths for a file type and module name, covering
 * both app/modules/{name}/... and modules/{name}/... roots, and both
 * public and private access levels (relative to project root).
 *
 * @example
 * getModulePaths(PlatformOSFileType.Partial, 'core') // → [
 *   'app/modules/core/public/views/partials',
 *   'app/modules/core/private/views/partials',
 *   'modules/core/public/views/partials',
 *   'modules/core/private/views/partials',
 *   'app/modules/core/public/lib',
 *   'app/modules/core/private/lib',
 *   'modules/core/public/lib',
 *   'modules/core/private/lib',
 * ]
 */
export function getModulePaths(type: PlatformOSFileType, moduleName: string): string[] {
  return FILE_TYPE_DIRS[type].flatMap((dir) => [
    `app/modules/${moduleName}/public/${dir}`,
    `app/modules/${moduleName}/private/${dir}`,
    `modules/${moduleName}/public/${dir}`,
    `modules/${moduleName}/private/${dir}`,
  ]);
}

/**
 * Returns true if the URI belongs to a recognized platformOS Liquid directory
 * and should be linted. Files outside known directories (e.g. generator
 * templates, build artifacts) return false and are excluded from linting.
 */
export function isKnownLiquidFile(uri: UriString): boolean {
  const type = getFileType(uri);
  return type !== undefined && LIQUID_FILE_TYPES.has(type);
}

export function isPartial(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Partial;
}

export function isPage(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Page;
}

export function isLayout(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Layout;
}

export function isAuthorization(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Authorization;
}

export function isEmail(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Email;
}

export function isApiCall(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.ApiCall;
}

export function isSms(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Sms;
}

export function isMigration(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.Migration;
}
