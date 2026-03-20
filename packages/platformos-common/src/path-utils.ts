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
 * Source of truth: app/services/app_builder/services/converters_config.rb and
 * app/models/concerns/deployable.rb in the platformOS server codebase.
 *
 * DIR_PREFIX (Ruby): ^/?((marketplace_builder|app)/|modules/(.+)(private|public)/)?
 * This means files can live under:
 *   - app/{dir}/
 *   - marketplace_builder/{dir}/          (legacy alias for app/)
 *   - modules/{name}/(public|private)/{dir}/
 *   - app/modules/{name}/(public|private)/{dir}/
 */

import { UriString } from './AbstractFileSystem';

/**
 * File types that exist in a platformOS app, each corresponding to a server-side
 * converter that processes the file on deploy.
 *
 * Liquid types:   Page, Layout, Partial, Authorization, Email, ApiCall, Sms, Migration, FormConfiguration
 * YAML types:     CustomModelType, InstanceProfileType, TransactableType, Translation
 * GraphQL types:  GraphQL
 * Binary/other:   Asset
 */
export enum PlatformOSFileType {
  // ── Liquid ──────────────────────────────────────────────────────────────────
  /** views/pages/ or pages/ → PageConverter */
  Page = 'Page',
  /** views/layouts/ → LiquidViewConverter (layouts) */
  Layout = 'Layout',
  /** views/partials/ or lib/ → LiquidViewConverter (partials) */
  Partial = 'Partial',
  /** authorization_policies/ → AuthorizationPolicyConverter */
  Authorization = 'Authorization',
  /** emails/ or notifications/email_notifications/ → EmailNotificationConverter */
  Email = 'Email',
  /** api_calls/ or notifications/api_call_notifications/ → ApiCallNotificationConverter */
  ApiCall = 'ApiCall',
  /** smses/ or notifications/sms_notifications/ → SmsNotificationConverter */
  Sms = 'Sms',
  /** migrations/ → MigrationConverter */
  Migration = 'Migration',
  /** form_configurations/ or forms/ → FormConfigurationConverter */
  FormConfiguration = 'FormConfiguration',

  // ── YAML ────────────────────────────────────────────────────────────────────
  /** custom_model_types/, model_schemas/, or schema/ → CustomModelTypeConverter */
  CustomModelType = 'CustomModelType',
  /** instance_profile_types/, user_profile_types/, or user_profile_schemas/ → InstanceProfileTypeConverter */
  InstanceProfileType = 'InstanceProfileType',
  /** transactable_types/ → TransactableTypeConverter */
  TransactableType = 'TransactableType',
  /** translations/ → TranslationConverter */
  Translation = 'Translation',

  // ── GraphQL ─────────────────────────────────────────────────────────────────
  /** graphql/ or graph_queries/ → GraphQueryConverter */
  GraphQL = 'GraphQL',

  // ── Binary/other ────────────────────────────────────────────────────────────
  /** assets/ → AssetConverter */
  Asset = 'Asset',
}

/**
 * The single source of truth for the platformOS directory structure.
 *
 * Maps each file type to its canonical directory name(s) relative to:
 *   - the app root:                  (app|marketplace_builder)/{dir}/
 *   - a module access level:         modules/{name}/(public|private)/{dir}/
 *   - a nested module access level:  app/modules/{name}/(public|private)/{dir}/
 *
 * Multiple dirs per type represent canonical + legacy aliases from the server
 * converters_config.rb FULL_PHYSICAL_PATH regexes.
 *
 * Types with multiple dirs (e.g. Partial) will match any of their dirs.
 * Order within each array doesn't matter for matching. Across types,
 * exact segment matching prevents false positives between overlapping paths
 * (e.g. app/lib/smses/ → Partial, not Sms).
 */
export const FILE_TYPE_DIRS: Readonly<Record<PlatformOSFileType, readonly string[]>> = {
  // Liquid
  [PlatformOSFileType.Page]: ['views/pages', 'pages'],
  [PlatformOSFileType.Layout]: ['views/layouts'],
  [PlatformOSFileType.Partial]: ['views/partials', 'lib'],
  [PlatformOSFileType.Authorization]: ['authorization_policies'],
  [PlatformOSFileType.Email]: ['emails', 'notifications/email_notifications'],
  [PlatformOSFileType.ApiCall]: ['api_calls', 'notifications/api_call_notifications'],
  [PlatformOSFileType.Sms]: ['smses', 'notifications/sms_notifications'],
  [PlatformOSFileType.Migration]: ['migrations'],
  [PlatformOSFileType.FormConfiguration]: ['form_configurations', 'forms'],
  // YAML
  [PlatformOSFileType.CustomModelType]: ['custom_model_types', 'model_schemas', 'schema'],
  [PlatformOSFileType.InstanceProfileType]: [
    'instance_profile_types',
    'user_profile_types',
    'user_profile_schemas',
  ],
  [PlatformOSFileType.TransactableType]: ['transactable_types'],
  [PlatformOSFileType.Translation]: ['translations'],
  // GraphQL
  [PlatformOSFileType.GraphQL]: ['graphql', 'graph_queries'],
  // Asset
  [PlatformOSFileType.Asset]: ['assets'],
};

/**
 * Liquid-containing file types. GraphQL, Asset, and YAML types are excluded
 * because they don't contain Liquid code and should not be passed to the
 * Liquid linter.
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
  PlatformOSFileType.FormConfiguration,
]);

/**
 * Pre-compiled regex per file type, derived entirely from FILE_TYPE_DIRS.
 *
 * For each canonical dir, three pattern alternatives are generated:
 *   /(app|marketplace_builder)/{dir}/  — direct app-level path (modern + legacy root)
 *   /(public|private)/{dir}/           — module path, covers both:
 *                                          modules/{name}/(public|private)/{dir}/
 *                                          app/modules/{name}/(public|private)/{dir}/
 *
 * Exact path segment matching prevents false positives:
 *   /app/lib/smses/file.liquid  → matches /app/lib/ → Partial (NOT Sms)
 *   /app/smses/file.liquid      → matches /app/smses/ → Sms (NOT Partial)
 */
const TYPE_MATCHERS = new Map<PlatformOSFileType, RegExp>(
  (Object.entries(FILE_TYPE_DIRS) as [PlatformOSFileType, readonly string[]][]).map(
    ([type, dirs]) => {
      const alternatives = dirs.flatMap((dir) => [
        `/(app|marketplace_builder)/${dir}/`,
        `/(public|private)/${dir}/`,
      ]);
      return [type, new RegExp(alternatives.join('|'))];
    },
  ),
);

/**
 * Returns the PlatformOSFileType for the given URI, or undefined if the URI
 * does not belong to any recognized platformOS directory.
 *
 * Supports both modern (app/) and legacy (marketplace_builder/) app roots,
 * as well as module paths (modules/{name}/public|private/).
 *
 * @example
 * getFileType('file:///root/app/lib/smses/notify.liquid')              // → Partial
 * getFileType('file:///root/app/smses/notify.liquid')                  // → Sms
 * getFileType('file:///root/marketplace_builder/views/pages/home.liquid') // → Page
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
 * Uses the modern `app/` root (not the legacy `marketplace_builder/` alias).
 *
 * @example
 * getAppPaths(PlatformOSFileType.Partial) // → ['app/views/partials', 'app/lib']
 * getAppPaths(PlatformOSFileType.GraphQL) // → ['app/graphql', 'app/graph_queries']
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
 *   ...
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

/**
 * Returns true if the URI has a `.liquid` extension but does not match any
 * recognized platformOS directory. Useful for detecting misplaced files that
 * the server will silently ignore.
 *
 * @example
 * isUnclassifiedLiquidFile('file:///project/scripts/helper.liquid') // → true
 * isUnclassifiedLiquidFile('file:///project/app/views/pages/home.liquid') // → false (Page)
 */
export function isUnclassifiedLiquidFile(uri: UriString): boolean {
  return uri.endsWith('.liquid') && getFileType(uri) === undefined;
}

/**
 * Returns true if the URI belongs to a recognized platformOS GraphQL directory
 * and should be linted. Files outside known directories (e.g. generator
 * templates, schema files, ERB templates) return false and are excluded.
 */
export function isKnownGraphQLFile(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.GraphQL;
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

export function isFormConfiguration(uri: UriString): boolean {
  return getFileType(uri) === PlatformOSFileType.FormConfiguration;
}

// ─── Module prefix utilities ──────────────────────────────────────────────────

/**
 * Result of parsing a `modules/{name}/...` prefix from a path or key.
 * Used by DocumentsLocator and TranslationProvider to route lookups to the
 * correct module directory.
 */
export type ModulePrefix =
  | { isModule: false; key: string }
  | { isModule: true; moduleName: string; key: string };

/**
 * Parse a `modules/{name}/{rest}` prefix from a path or translation key.
 * Returns the module name and the remaining key, or marks it as non-module.
 *
 * @example
 * parseModulePrefix('modules/community/components/card') // → { isModule: true, moduleName: 'community', key: 'components/card' }
 * parseModulePrefix('modules/community/hello.world')     // → { isModule: true, moduleName: 'community', key: 'hello.world' }
 * parseModulePrefix('app/views/partials/card')           // → { isModule: false, key: 'app/views/partials/card' }
 * parseModulePrefix('modules/community')                 // → { isModule: false, key: 'modules/community' } (no key segment)
 */
export function parseModulePrefix(path: string): ModulePrefix {
  if (!path.startsWith('modules/')) {
    return { isModule: false, key: path };
  }

  const withoutPrefix = path.slice('modules/'.length);
  const slashIdx = withoutPrefix.indexOf('/');

  if (slashIdx === -1) {
    // Just "modules/name" with no key segment
    return { isModule: false, key: path };
  }

  const moduleName = withoutPrefix.slice(0, slashIdx);
  const key = withoutPrefix.slice(slashIdx + 1);

  // moduleName must be non-empty to be a valid module prefix.
  // key may be empty (e.g. 'modules/users/') — that means "all files in the module".
  return moduleName ? { isModule: true, moduleName, key } : { isModule: false, key: path };
}
