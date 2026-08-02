/**
 * Utility functions for identifying platformOS file types based on their paths.
 *
 * Architecture:
 * - FILE_TYPE_DIRS is the single source of truth for all platformOS directory names
 * - REFERENCE_EXTENSIONS is the same for extensions, and EXTENSION_AGNOSTIC_TYPES says
 *   which types the backend lets deploy under any extension
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
import { sourceCodeTypeOf } from './app/types';
import { relativeUriPath } from './app/uri';
import { KNOWN_FORMATS } from './route-table/slugFromFilePath';

/**
 * File types that exist in a platformOS app, each corresponding to a server-side
 * converter that processes the file on deploy.
 *
 * Liquid types:   Page, Layout, Partial, Authorization, Email, ApiCall, Sms, Migration, FormConfiguration
 * YAML types:     Table, UserProfileType, TransactableType, Translation
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
  /**
   * `schema/` → the Tables that describe Records. `custom_model_types/` and
   * `model_schemas/` are legacy spellings of the same thing.
   * https://documentation.platformos.com/developer-guide/records/records-tables
   */
  Table = 'Table',
  /** user_profile_types/, instance_profile_types/, or user_profile_schemas/ → UserProfileTypeConverter */
  UserProfileType = 'UserProfileType',
  /** transactable_types/ → TransactableTypeConverter */
  TransactableType = 'TransactableType',
  /** translations/ → TranslationConverter */
  Translation = 'Translation',
  /** activity_streams/handlers/ → ActivityStreamsHandlerConverter */
  ActivityStreamsHandler = 'ActivityStreamsHandler',
  /** activity_streams/grouping_handlers/ → ActivityStreamsGroupingHandlerConverter */
  ActivityStreamsGroupingHandler = 'ActivityStreamsGroupingHandler',
  /** `config.yml` — the app's configuration flags. A single file, not a directory. */
  InstanceConfig = 'InstanceConfig',
  /** `user.yml` — the property schema shared by all users. A single file, not a directory. */
  UserSchema = 'UserSchema',

  // ── GraphQL ─────────────────────────────────────────────────────────────────
  /** graphql/ or graph_queries/ → GraphQueryConverter */
  GraphQL = 'GraphQL',

  // ── Binary/other ────────────────────────────────────────────────────────────
  /** assets/ → AssetConverter */
  Asset = 'Asset',
}

/**
 * The types that are ONE FILE at a fixed path rather than a directory of files, and
 * the filename each is.
 *
 * `app/config.yml` and `app/user.yml` are the whole set. They are the reason
 * {@link FILE_TYPE_DIRS} alone cannot be called the source of truth for the app
 * layout: every entry there describes `{root}/{dir}/{rest}`, and these two have no
 * `{dir}` and no `{rest}`.
 *
 * They are also app-scoped only — unlike every directory type, there is no
 * `modules/<name>/{public,private}/config.yml`. Ruby agrees: `App::CONFIG_REGEX` and
 * `USER_SCHEMA_REGEX` are the only two entries in its `REGEXP_MAP` whose prefix
 * alternation omits the `modules/` branch.
 *
 * Source of truth:
 * https://documentation.platformos.com/developer-guide/platformos-workflow/directory-structure
 */
export const FILE_TYPE_FILES: Readonly<Partial<Record<PlatformOSFileType, string>>> = {
  [PlatformOSFileType.InstanceConfig]: 'config.yml',
  [PlatformOSFileType.UserSchema]: 'user.yml',
};

/** Whether `type` is one file at a fixed path rather than a directory of files. */
export function isFixedPathFileType(type: PlatformOSFileType): boolean {
  return FILE_TYPE_FILES[type] !== undefined;
}

/**
 * The project-relative path of a fixed-path file, or `undefined` for a
 * directory-based type.
 *
 * This is the path lookup for the two types {@link nameToPaths} deliberately answers
 * nothing for: they are not referenceable BY NAME, but they do live somewhere, and
 * that somewhere belongs here rather than being spelled at each reader.
 *
 * @example getFixedFilePath(PlatformOSFileType.InstanceConfig) // → 'app/config.yml'
 */
export function getFixedFilePath(type: PlatformOSFileType): string | undefined {
  const fileName = FILE_TYPE_FILES[type];
  return fileName === undefined ? undefined : getAppDirPath(fileName);
}

/**
 * The types that live in a DIRECTORY, i.e. everything except the two singleton
 * config files. Only these appear in {@link FILE_TYPE_DIRS}.
 */
export type DirectoryFileType = Exclude<
  PlatformOSFileType,
  PlatformOSFileType.InstanceConfig | PlatformOSFileType.UserSchema
>;

/**
 * The single source of truth for the platformOS directory structure.
 *
 * Covers the DIRECTORY-based types only; the two fixed-path files (`config.yml`,
 * `user.yml`) are in {@link FILE_TYPE_FILES} because they have no directory segment.
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
export const FILE_TYPE_DIRS: Readonly<Partial<Record<PlatformOSFileType, readonly string[]>>> & {
  readonly [K in DirectoryFileType]: readonly string[];
} = {
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
  // Current directory first: it is the canonical one, which is what `nameToPaths`
  // resolves to first and what `nameToCreationPath` offers. The rest are legacy
  // spellings the server still accepts.
  [PlatformOSFileType.Table]: ['schema', 'custom_model_types', 'model_schemas'],
  [PlatformOSFileType.UserProfileType]: [
    'user_profile_types',
    'instance_profile_types',
    'user_profile_schemas',
  ],
  [PlatformOSFileType.TransactableType]: ['transactable_types'],
  [PlatformOSFileType.Translation]: ['translations'],
  // activity_streams/handler.rb:5 and activity_streams/grouping_handler.rb:5. Nested
  // two deep, like notifications/email_notifications above.
  [PlatformOSFileType.ActivityStreamsHandler]: ['activity_streams/handlers'],
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: ['activity_streams/grouping_handlers'],
  // No InstanceConfig / UserSchema entries: they have no directory of their own.
  // See FILE_TYPE_FILES.
  // GraphQL
  // backend quirk NOT mirrored: graph_query.rb:5 is `(graph_queries|graphql)s?/`, so the
  // platform also accepts `graphqls/`. A fourth spelling costs four more candidate paths
  // on every unresolved `{% graphql %}` — nameToPaths feeds DocumentsLocator's stat walk —
  // and no real project uses it. Deliberate deviation, not an oversight.
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
 * YAML-based file types. Liquid, GraphQL, and Asset types are excluded.
 */
const YAML_FILE_TYPES = new Set<PlatformOSFileType>([
  PlatformOSFileType.Table,
  PlatformOSFileType.UserProfileType,
  PlatformOSFileType.TransactableType,
  PlatformOSFileType.Translation,
  PlatformOSFileType.ActivityStreamsHandler,
  PlatformOSFileType.ActivityStreamsGroupingHandler,
  PlatformOSFileType.InstanceConfig,
  PlatformOSFileType.UserSchema,
]);

/**
 * GraphQL-based file types. A set of one, stated the same way as the other two so
 * that {@link isSupportedSourceFile} asks all three the same question.
 */
const GRAPHQL_FILE_TYPES = new Set<PlatformOSFileType>([PlatformOSFileType.GraphQL]);

/**
 * The extension a reference of each type resolves with — what {@link nameToPaths}
 * appends, what {@link pathToName} strips, and, for every type the backend anchors,
 * what a path must END IN to be classified as that type at all.
 *
 * `Asset` is absent on purpose: an asset reference carries its own extension
 * (`{% asset 'theme.css' %}`), so nothing is appended and nothing is stripped.
 *
 * **`.yaml` is absent on purpose too.** Every YAML model in the backend anchors
 * `\.yml\z` — `translation.rb:7`, `custom_model_type.rb:12`,
 * `instance_profile_type.rb:7`, `transactable_type.rb:7`, `activity_streams/handler.rb:7`
 * — so `app/translations/en.yaml` is not deployed. Listing it here would also put it in
 * {@link SOURCE_FILE_EXTENSIONS}, and every walker and watcher in the toolchain derives
 * from that, so the whole toolchain would collect and lint a file the platform ignores.
 */
const REFERENCE_EXTENSIONS: Readonly<Partial<Record<PlatformOSFileType, readonly string[]>>> = {
  [PlatformOSFileType.Page]: ['.liquid'],
  [PlatformOSFileType.Layout]: ['.liquid'],
  [PlatformOSFileType.Partial]: ['.liquid'],
  [PlatformOSFileType.Authorization]: ['.liquid'],
  [PlatformOSFileType.Email]: ['.liquid'],
  [PlatformOSFileType.ApiCall]: ['.liquid'],
  [PlatformOSFileType.Sms]: ['.liquid'],
  [PlatformOSFileType.Migration]: ['.liquid'],
  [PlatformOSFileType.FormConfiguration]: ['.liquid'],
  [PlatformOSFileType.Table]: ['.yml'],
  [PlatformOSFileType.UserProfileType]: ['.yml'],
  [PlatformOSFileType.TransactableType]: ['.yml'],
  [PlatformOSFileType.Translation]: ['.yml'],
  [PlatformOSFileType.ActivityStreamsHandler]: ['.yml'],
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: ['.yml'],
  // `.yml` only, not `.yaml`: there is exactly one config file per app and the
  // platform reads it by that exact name, so `app/config.yaml` is an unclassified
  // YAML file rather than a second spelling of the config.
  [PlatformOSFileType.InstanceConfig]: ['.yml'],
  [PlatformOSFileType.UserSchema]: ['.yml'],
  [PlatformOSFileType.GraphQL]: ['.graphql'],
};

/**
 * The types the backend classifies by DIRECTORY alone: their `PHYSICAL_PATH` ends in
 * `(.+)` with no extension anchor, so a file of any extension deploys.
 *
 *   Page            `(pages|views/pages)/(.+)`                  — page.rb:7
 *   Layout, Partial `(views/partials|views/layouts|lib)/(.+)`   — instance_view.rb:9
 *   Asset           `assets/`                                    — asset.rb:8
 *
 * So `app/views/pages/home.html` IS a Page and `app/views/partials/x.css.liquid` IS a
 * Partial. Whether the LINTER can read one is a different question, and
 * {@link isSupportedSourceFile} is where it is asked.
 *
 * Note `instance_view.rb:8` defines an unused `EXTENSION = '.liquid'` constant beside
 * the regexp. The regexp is what runs.
 */
const EXTENSION_AGNOSTIC_TYPES = new Set<PlatformOSFileType>([
  PlatformOSFileType.Page,
  PlatformOSFileType.Layout,
  PlatformOSFileType.Partial,
  PlatformOSFileType.Asset,
]);

/**
 * The regexp fragment that pins `type`'s extension, or `''` when any extension
 * classifies.
 *
 * This is what makes a known directory NOT enough on its own. Without it
 * `app/graphql/x.yml` was a GraphQL file and `app/translations/en.json` a Translation:
 * both classified, neither deployed, and the first was handed to the YAML parser
 * because `sourceCodeTypeOf` reads the extension while classification did not.
 */
function extensionPattern(type: PlatformOSFileType): string {
  if (EXTENSION_AGNOSTIC_TYPES.has(type)) return '';
  const extensions = REFERENCE_EXTENSIONS[type];
  if (extensions === undefined || extensions.length === 0) return '';
  return `\\.(?:${extensions.map((extension) => extension.slice(1)).join('|')})`;
}

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
const TYPE_MATCHERS = new Map<PlatformOSFileType, RegExp>([
  // Fixed-path files first: `app/config.yml` has no directory segment, so the
  // dir-based alternatives below can never match it. App-scoped only — there is no
  // module form — and anchored at the end so `app/config.yml.bak` is not a config.
  ...(Object.entries(FILE_TYPE_FILES) as [PlatformOSFileType, string][]).map(
    ([type, fileName]): [PlatformOSFileType, RegExp] => [
      type,
      new RegExp(`/(app|marketplace_builder)/${fileName.replace(/\./g, '\\.')}$`),
    ],
  ),
  ...(Object.entries(FILE_TYPE_DIRS) as [PlatformOSFileType, readonly string[]][])
    // A fixed-path type has no directories; joining an empty alternation would build
    // `new RegExp('')`, which matches every URI.
    .filter(([, dirs]) => dirs.length > 0)
    .map(([type, dirs]): [PlatformOSFileType, RegExp] => {
      const alternatives = dirs.flatMap((dir) => [
        `/(app|marketplace_builder)/${dir}/`,
        `/(public|private)/${dir}/`,
      ]);
      // `.*{suffix}$` rather than a bare "contains": for every type but the four in
      // EXTENSION_AGNOSTIC_TYPES the backend anchors the extension, so being in the
      // directory is not enough. With an empty suffix this is the old behaviour.
      return [type, new RegExp(`(?:${alternatives.join('|')}).*${extensionPattern(type)}$`)];
    }),
]);

/**
 * What the platform does with the file at `uri`, or `undefined` when it does
 * nothing with it — the file is not part of the app.
 *
 * **`rootUri` is required, and that is the point.** A platformOS file is one whose
 * position RELATIVE TO THE PROJECT ROOT matches the directory structure, so a
 * classifier without a root cannot answer the question; it can only test whether a
 * known directory name appears somewhere in the string, which is a different and
 * wrong question. `seed/post_import/app/migrations/x.liquid` contains
 * `app/migrations/` and is not a migration: it is not deployed, so nothing it renders
 * or queries exists to be resolved, and every diagnostic produced for it is noise
 * about a file the platform will never run.
 *
 * That used to be two answers. `App` classified with the anchored `parseAppPath` while
 * this function matched anywhere, so one file was a Migration to the language server,
 * the graph and the VS Code extension, and absent from the lint's app. Requiring the
 * root is what makes the unanchored answer unspeakable rather than merely discouraged.
 *
 * @example
 * getFileType('file:///r/app/lib/smses/notify.liquid', 'file:///r')  // → Partial
 * getFileType('file:///r/app/smses/notify.liquid', 'file:///r')      // → Sms
 * getFileType('file:///r/seed/app/migrations/x.liquid', 'file:///r') // → undefined
 */
export function getFileType(uri: UriString, rootUri: UriString): PlatformOSFileType | undefined {
  return parseAppPath(relativeUriPath(uri, rootUri))?.fileType;
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
  // A fixed-path type (`config.yml`, `user.yml`) has no directory, so no search paths.
  return (FILE_TYPE_DIRS[type] ?? []).map(getAppDirPath);
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
  // Fixed-path types are app-scoped: there is no modules/<name>/…/config.yml.
  return (FILE_TYPE_DIRS[type] ?? []).flatMap((dir) => getModuleDirPaths(dir, moduleName));
}

/**
 * The app-level search path for an arbitrary directory name (relative to project
 * root).
 *
 * For a `PlatformOSFileType` prefer {@link getAppPaths}. This is for the places that
 * are handed a directory name rather than a type — frontmatter association keys
 * (`authorization_policies`, `email_notifications`, …) resolved through
 * `FRONTMATTER_ASSOCIATION_DIRS`.
 */
export function getAppDirPath(dir: string): string {
  return `app/${dir}`;
}

/**
 * Every module search path for an arbitrary directory name and module, in
 * RESOLUTION ORDER: the `app/modules/<name>` overwrite before the `modules/<name>`
 * original, and `public` before `private` within each.
 *
 * This ordering is the single definition of module shadowing — {@link getModulePaths}
 * and `AppPathInfo.searchPathIndex` both derive from it, which is why a name index
 * and a candidate-path walk cannot disagree about which file a name resolves to.
 */
export function getModuleDirPaths(dir: string, moduleName: string): string[] {
  return MODULE_ROOTS.flatMap((root) =>
    ACCESS_LEVELS.map((access) => `${root}/${moduleName}/${access}/${dir}`),
  );
}

/**
 * Returns true if the URI belongs to a recognized platformOS Liquid directory
 * and should be linted. Files outside known directories (e.g. generator
 * templates, build artifacts) return false and are excluded from linting.
 */
export function isKnownLiquidFile(uri: UriString, rootUri: UriString): boolean {
  const type = getFileType(uri, rootUri);
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
export function isUnclassifiedLiquidFile(uri: UriString, rootUri: UriString): boolean {
  return uri.endsWith('.liquid') && getFileType(uri, rootUri) === undefined;
}

/**
 * Returns true if the URI belongs to a recognized platformOS GraphQL directory
 * and should be linted. Files outside known directories (e.g. generator
 * templates, schema files, ERB templates) return false and are excluded.
 */
export function isKnownGraphQLFile(uri: UriString, rootUri: UriString): boolean {
  const type = getFileType(uri, rootUri);
  return type !== undefined && GRAPHQL_FILE_TYPES.has(type);
}

/**
 * Returns true if the URI is a platformOS YAML source: a translation, table, profile
 * type, transactable type or ActivityStreams handler, or one of the two fixed-path
 * files (`app/config.yml`, `app/user.yml`).
 *
 * A YAML file the platform does not deploy returns false — `.platformos-check.yml`,
 * `.github/workflows/ci.yml`, and now also `app/translations/en.yaml`, since every
 * backend YAML model anchors `\.yml\z`.
 */
export function isKnownYAMLFile(uri: UriString, rootUri: UriString): boolean {
  const type = getFileType(uri, rootUri);
  return type !== undefined && YAML_FILE_TYPES.has(type);
}

/**
 * Whether the URI is a platformOS source file the LSP and linter should load and
 * parse.
 *
 * The intersection of the toolchain's two whitelists, and nothing else:
 *
 *   1. **the platform deploys it** — {@link getFileType}, over `FILE_TYPE_DIRS` and
 *      `REFERENCE_EXTENSIONS`;
 *   2. **we have a parser for it** — `sourceCodeTypeOf`, over the source keys in
 *      `app/types.ts`.
 *
 * There is deliberately no third clause. This function used to open with
 * `if (/\.(s?css|js)\.liquid$/.test(uri)) return false`, and an ignore-list in one
 * predicate is only ever consulted by the callers of that predicate: the language
 * server refused `theme.css.liquid` while the lint, which asks `App.fromPaths` and
 * `sourceCodeTypeOf` instead, put it in the app with the Liquid+HTML parser and
 * reported `LiquidHTMLSyntaxError` on it. Moving the exclusion into the ABSENCE of a
 * parser row fixed both at once and cannot come apart again.
 *
 * The two clauses answer genuinely different questions and neither implies the other.
 * `app/views/pages/home.html` is a Page the platform deploys (1 yes, 2 no); a
 * `.liquid` file in `scripts/` parses fine and is not deployed (2 yes, 1 no).
 */
export function isSupportedSourceFile(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) !== undefined && sourceCodeTypeOf(uri) !== undefined;
}

/**
 * One-type convenience wrappers over {@link getFileType}. They take a root for the
 * same reason it does — a file's type is its position relative to the project root —
 * so there is no cheaper, wronger way to ask.
 *
 * A caller holding an `AppFile` should read `file.fileType` instead: the App parsed
 * the path once at construction, so these re-derive what it already knows.
 */
export function isPartial(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Partial;
}

export function isPage(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Page;
}

export function isLayout(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Layout;
}

export function isAuthorization(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Authorization;
}

export function isEmail(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Email;
}

export function isApiCall(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.ApiCall;
}

export function isSms(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Sms;
}

export function isMigration(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.Migration;
}

export function isFormConfiguration(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) === PlatformOSFileType.FormConfiguration;
}

// ─── Structured path parsing ──────────────────────────────────────────────────

/**
 * The roots an app-level file can live under. `app/` is canonical.
 *
 * `marketplace_builder` stays. Dropping it was planned and reversed (TASK-1,
 * 2026-08-02): the backend still accepts it — `deployable.rb:21`,
 * `DIR_PREFIX = %r{^/?((marketplace_builder|app)/|modules/(.+)(private|public|marketplace_builder|app)/)?}`
 * — so removing it here while claiming to mirror the backend was self-contradictory.
 * The asymmetry decides it either way: keeping a dead root costs one regexp
 * alternative, while dropping a live one makes a project on it lint nothing at all,
 * silently.
 */
const APP_ROOTS = ['app', 'marketplace_builder'] as const;

/**
 * The roots modules live under, in resolution order: an `app/modules/<name>` copy
 * shadows the `modules/<name>` original of the same name.
 *
 * Exported so that enumerating modules — which `getModulePaths` cannot do, since it
 * needs a name — does not become a second place that knows this.
 */
export const MODULE_ROOTS = ['app/modules', 'modules'] as const;

/** The access levels a module directory is split into. */
const ACCESS_LEVELS = ['public', 'private'] as const;

export type AppRoot = (typeof APP_ROOTS)[number];
export type ModuleAccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * The subtrees of a project, relative to its root, that an app file can live in.
 * `*` is exactly one path segment — a module name.
 *
 * This is {@link parseAppPath}'s grammar stated as a prefix, so it is the ONLY
 * thing a project walk needs in order to skip everything else. A walk that instead
 * blacklists directory names (`node_modules`, `dist`, `tmp`, `vendor`, …) is
 * answering a different and wrong question: `tmp/app/views/partials/x.liquid` is
 * not a partial — not because it is under `tmp`, but because from the root it is
 * not under `app/`, `marketplace_builder/` or `modules/<name>/(public|private)/`.
 * By the same rule `app/views/pages/vendor/x.liquid` IS a page, and any blacklist
 * containing `vendor` silently loses it.
 *
 * `app/modules/<name>/…` needs no entry of its own: it is under `app`.
 */
export const APP_SOURCE_SUBTREES: readonly string[] = [
  ...APP_ROOTS,
  ...MODULE_ROOTS.filter(
    (root) => !APP_ROOTS.some((appRoot) => root.startsWith(`${appRoot}/`)),
  ).flatMap((root) => ACCESS_LEVELS.map((access) => `${root}/*/${access}`)),
];

/**
 * Everything the directory structure says about one file, resolved in a single
 * anchored pass over {@link FILE_TYPE_DIRS}.
 *
 * Unlike {@link getFileType} — which tests for a known directory ANYWHERE in a
 * URI — this parses a path *relative to the project root*, so it can also report
 * which directory of the type matched, which module the file belongs to, and the
 * logical name a `render`/`function`/`include` would refer to it by.
 */
export interface AppPathInfo {
  /** The file's platformOS classification. */
  fileType: PlatformOSFileType;
  /** Which entry of `FILE_TYPE_DIRS[fileType]` this file lives under. */
  dir: string;
  /** The app root, for an app-level file. */
  root?: AppRoot;
  /** The module this file belongs to, for a module file. */
  moduleName?: string;
  /** The access level of the module directory, for a module file. */
  access?: ModuleAccessLevel;
  /**
   * True for `app/modules/<name>/…`: a module file vendored into the app, which
   * shadows the `modules/<name>/…` original of the same name.
   */
  isModuleOverwrite: boolean;
  /** The path below the type directory, extension intact. */
  rest: string;
  /**
   * Where this file's directory sits in the candidate list
   * {@link getAppPaths} / {@link getModulePaths} produce for its type, or
   * `undefined` when it lives under a root those never search (i.e. the legacy
   * `marketplace_builder/`).
   *
   * This is what lets a name index reproduce "first candidate path that exists
   * wins" — the rule `DocumentsLocator.locate` walks — as a comparison instead
   * of a sequence of `stat` calls.
   */
  searchPathIndex?: number;
}

/**
 * One anchored regex per (type, dir) pair, in {@link FILE_TYPE_DIRS} order so
 * that the first match wins exactly as it does in {@link getFileType} — which is
 * what keeps `app/lib/smses/notify.liquid` a Partial rather than an Sms.
 */
const PATH_PATTERNS: readonly {
  fileType: PlatformOSFileType;
  dir: string;
  dirIndex: number;
  appLevel: RegExp;
  moduleLevel: RegExp;
}[] = (Object.entries(FILE_TYPE_DIRS) as [PlatformOSFileType, readonly string[]][]).flatMap(
  ([fileType, dirs]) => {
    // Inside the `rest` capture, not after it: `rest` is documented as the path below
    // the type directory with its extension intact, and pathToName strips it from there.
    const rest = `(.+${extensionPattern(fileType)})`;
    return dirs.map((dir, dirIndex) => ({
      fileType,
      dir,
      dirIndex,
      appLevel: new RegExp(`^(${APP_ROOTS.join('|')})/${dir}/${rest}$`),
      moduleLevel: new RegExp(
        `^(app/)?modules/([^/]+)/(${ACCESS_LEVELS.join('|')})/${dir}/${rest}$`,
      ),
    }));
  },
);

/**
 * Parse a root-relative, forward-slash path into everything the directory
 * structure implies about it, or `undefined` when it is not in a recognized
 * platformOS directory.
 *
 * @example
 * parseAppPath('app/views/partials/ui/card.liquid')
 * // → { fileType: Partial, dir: 'views/partials', root: 'app', rest: 'ui/card.liquid', searchPathIndex: 0, … }
 * parseAppPath('modules/core/public/lib/commands/create.liquid')
 * // → { fileType: Partial, dir: 'lib', moduleName: 'core', access: 'public', rest: 'commands/create.liquid', searchPathIndex: 6, … }
 */
export function parseAppPath(relativePath: string): AppPathInfo | undefined {
  const path = relativePath.replace(/^\/+/, '');

  // Fixed-path files (`app/config.yml`, `app/user.yml`) are checked first because
  // they have no directory segment for the patterns below to match against. `dir` is
  // empty and `rest` is the filename itself — there is no path under a directory to
  // report. Compared as strings rather than by regex: this function runs once per
  // file in the project, so it should not allocate a RegExp per call.
  for (const [fileType, fileName] of Object.entries(FILE_TYPE_FILES) as [
    PlatformOSFileType,
    string,
  ][]) {
    for (const root of APP_ROOTS) {
      if (path !== `${root}/${fileName}`) continue;
      return {
        fileType,
        dir: '',
        root,
        isModuleOverwrite: false,
        rest: fileName,
        searchPathIndex: root === 'app' ? 0 : undefined,
      };
    }
  }

  for (const { fileType, dir, dirIndex, appLevel, moduleLevel } of PATH_PATTERNS) {
    const appMatch = appLevel.exec(path);
    if (appMatch) {
      const [, root, rest] = appMatch as unknown as [string, AppRoot, string];
      return {
        fileType,
        dir,
        root,
        isModuleOverwrite: false,
        rest,
        // getAppPaths() only ever searches `app/`, so a marketplace_builder file
        // has no position in the walk.
        searchPathIndex: root === 'app' ? dirIndex : undefined,
      };
    }

    const moduleMatch = moduleLevel.exec(path);
    if (moduleMatch) {
      const [, appPrefix, moduleName, access, rest] = moduleMatch as unknown as [
        string,
        string | undefined,
        string,
        ModuleAccessLevel,
        string,
      ];
      const isModuleOverwrite = appPrefix !== undefined;
      return {
        fileType,
        dir,
        moduleName,
        access,
        isModuleOverwrite,
        rest,
        // Mirrors getModulePaths()'s emission order: dir-major, then
        // app/modules before modules, then public before private.
        searchPathIndex: dirIndex * 4 + (isModuleOverwrite ? 0 : 2) + (access === 'public' ? 0 : 1),
      };
    }
  }

  return undefined;
}

// ─── name ⇄ path ──────────────────────────────────────────────────────────────

/**
 * The extensions a reference of `fileType` resolves with, canonical spelling first, or
 * `[]` for `Asset`, whose references carry their own extension.
 *
 * Exported so that a caller which needs to SPELL a path of a given type — a test
 * generating one per type, a scaffold, a rename — does not hand-maintain a switch over
 * the enum. Two such switches had already drifted into the specs and both silently
 * stopped covering a type the moment one was added.
 */
export function getReferenceExtensions(fileType: PlatformOSFileType): readonly string[] {
  return REFERENCE_EXTENSIONS[fileType] ?? [];
}

/**
 * Every extension a platformOS SOURCE file can have — what a project walk has to
 * collect for the app to be complete.
 *
 * Derived from {@link REFERENCE_EXTENSIONS}, so adding a file type gives the
 * walkers its extension for free and no consumer holds a second copy of the list.
 * Assets are absent for the same reason they are absent there: they carry their
 * own extension, are never parsed, and nothing lints them.
 *
 * A consumer collecting these still gets a superset of the app — `bin/deploy.yml`
 * has a source extension and is not a platformOS file. What a path IS remains
 * {@link parseAppPath}'s answer, and `App.fromPaths` is where it gets asked.
 */
export const SOURCE_FILE_EXTENSIONS: readonly string[] = [
  ...new Set(Object.values(REFERENCE_EXTENSIONS).flat()),
];

/**
 * {@link SOURCE_FILE_EXTENSIONS} as a brace-expansion glob, matching every source
 * file at any depth below wherever it is anchored.
 *
 * Every walker and watcher in the toolchain needs the list in exactly this shape —
 * the lint's project glob, the language server's file-operation filter and its
 * file watcher — and each of them used to spell it out. Two of those spellings had
 * already drifted: the LSP's filter listed `json` (never a platformOS source) and
 * omitted `yml`, so renaming a translation file was silently not handled.
 *
 * It is deliberately NOT anchored to `app/`: a consumer joins it onto whatever root
 * or subtree it is walking (`APP_SOURCE_SUBTREES` for the lint), or uses it as-is
 * where the pattern is already relative to the workspace root (the LSP).
 */
export const SOURCE_FILE_GLOB = `**/*.{${SOURCE_FILE_EXTENSIONS.map((extension) =>
  extension.slice(1),
).join(',')}}`;

/**
 * The types whose filename may carry a response format (`1col.html.liquid`) that is
 * NOT part of the name a reference uses.
 *
 * A layout is referenced as `application` whether the file is `application.liquid` or
 * `application.html.liquid` — the documented example layout is in fact
 * `views/layouts/1col.html.liquid`, referenced as `1col`. Partials behave the same way.
 *
 * `Page` is deliberately EXCLUDED. A page's format selects the endpoint:
 * `api/users.json.liquid` and `api/users.liquid` are two different pages serving two
 * different routes, so collapsing them to one name would make them collide.
 */
const FORMAT_BEARING_TYPES = new Set<PlatformOSFileType>([
  PlatformOSFileType.Layout,
  PlatformOSFileType.Partial,
]);

/**
 * The format spellings {@link nameToPaths} enumerates, plain first.
 *
 * Deliberately just `html`, not every {@link KNOWN_FORMATS} entry, because these
 * candidates get `stat`-ed one by one by `DocumentsLocator`'s walk: enumerating all
 * twelve formats would turn one unresolved `{% render %}` into 26 filesystem calls
 * instead of 4. `html` is the only format the documented layout and partial examples
 * use, and `.liquid` + `.html.liquid` is exactly what the shipped layout check probed.
 *
 * {@link pathToName} is NOT limited this way — it strips any known format — so an
 * `App` index built from paths resolves a `1col.json.liquid` layout under the name
 * `1col` even though the walk would not find it. That is the right way round: the
 * index is the primary resolver and the walk is the fallback for callers with no App.
 */
const WALKED_FORMAT_SUFFIXES = ['', '.html'] as const;

/** What {@link pathToName} resolved a path to. */
export interface LogicalName {
  /** The file's platformOS classification. */
  fileType: PlatformOSFileType;
  /**
   * The name a reference uses: the path with its type's directory prefix and
   * extension removed, `modules/<name>/`-prefixed for a module file. Assets keep
   * their extension.
   */
  name: string;
  /** The module this file belongs to, for a module file. */
  moduleName?: string;
}

/**
 * The logical name a reference uses for the file at `relativePath` — the inverse of
 * {@link nameToPaths}.
 *
 * This and `nameToPaths` are the single definition of how a `{% render %}`,
 * `{% function %}`, `{% graphql %}`, `{% asset %}` or `layout:` reference relates to
 * a file on disk. Every caller that needs either direction must go through them: a
 * second copy of the rule is how `platformos-graph` came to resolve
 * `{{ 'app.js' | asset_url }}` to a root-level `assets/app.js` while
 * `DocumentsLocator` resolved it to `app/assets/app.js`.
 *
 * @example pathToName('app/views/partials/ui/card.liquid')       // → { fileType: Partial, name: 'ui/card' }
 * @example pathToName('modules/core/public/lib/create.liquid')   // → { fileType: Partial, name: 'modules/core/create', moduleName: 'core' }
 * @example pathToName('app/assets/styles/theme.css')             // → { fileType: Asset, name: 'styles/theme.css' }
 */
export function pathToName(relativePath: string): LogicalName | undefined {
  const info = parseAppPath(relativePath);
  if (!info) return undefined;

  const base = stripReferenceExtension(info.fileType, info.rest);
  const prefix = info.moduleName ? `modules/${info.moduleName}/` : '';

  return {
    fileType: info.fileType,
    name: base.startsWith(prefix) ? base : `${prefix}${base}`,
    moduleName: info.moduleName,
  };
}

/**
 * Every path a reference `name` of `fileType` can resolve to, relative to the
 * project root, **in resolution order** — the inverse of {@link pathToName}.
 *
 * The first entry is the canonical location, which is what a caller that must name a
 * file that does not exist yet should use. A caller that wants the file that DOES
 * exist should try them in order, or ask `App.find`, which returns the same answer
 * without touching the filesystem.
 *
 * `modules/<name>/…` references route to that module's directories, app-level
 * overwrite first — the shadowing rule from
 * https://documentation.platformos.com/developer-guide/modules/modules.
 *
 * @example nameToPaths(Partial, 'ui/card')
 * // → ['app/views/partials/ui/card.liquid', 'app/lib/ui/card.liquid']
 * @example nameToPaths(Asset, 'theme.css')
 * // → ['app/assets/theme.css']
 * @example nameToPaths(Partial, 'modules/core/card')
 * // → ['app/modules/core/public/views/partials/card.liquid', …, 'modules/core/private/lib/card.liquid']
 * @example nameToPaths(InstanceConfig, 'config')
 * // → ['app/config.yml']
 */
export function nameToPaths(fileType: PlatformOSFileType, name: string): string[] {
  const parsed = parseModulePrefix(name);

  // A fixed-path file has one name and one path, and no module form — so the only
  // name that resolves is the one `pathToName` produces for it, and a module-prefixed
  // name resolves to nothing. The directory machinery below cannot express that,
  // because there is no directory.
  const fixedPath = getFixedFilePath(fileType);
  if (fixedPath !== undefined) {
    return !parsed.isModule && parsed.key === fixedNameOf(fileType) ? [fixedPath] : [];
  }

  const searchPaths = parsed.isModule
    ? getModulePaths(fileType, parsed.moduleName)
    : getAppPaths(fileType);
  const extensions = REFERENCE_EXTENSIONS[fileType] ?? [''];
  const suffixes = FORMAT_BEARING_TYPES.has(fileType) ? WALKED_FORMAT_SUFFIXES : [''];

  return searchPaths.flatMap((searchPath) =>
    suffixes.flatMap((suffix) =>
      extensions.map((extension) => `${searchPath}/${parsed.key}${suffix}${extension}`),
    ),
  );
}

/** The one reference name a fixed-path file answers to: its filename, extension off. */
function fixedNameOf(fileType: PlatformOSFileType): string | undefined {
  const fileName = FILE_TYPE_FILES[fileType];
  if (fileName === undefined) return undefined;
  const [extension = ''] = REFERENCE_EXTENSIONS[fileType] ?? [];
  return extension && fileName.endsWith(extension)
    ? fileName.slice(0, -extension.length)
    : fileName;
}

/**
 * Where a file called `name` WOULD be created — which is not the same question as
 * where it is looked for.
 *
 * {@link nameToPaths} answers "which paths could this name mean", ordered so the file
 * that already exists wins; that order puts the `app/modules/<name>` OVERWRITE slot
 * first, because an overwrite shadows the original. Creation is the opposite: a new
 * module file belongs in the module itself (`modules/<name>/public/…`), not in the
 * slot that exists to override someone else's file.
 *
 * `dirIndex` selects among a type's directory aliases, which is how `function` lands
 * in `app/lib` while `render` lands in `app/views/partials` — both are Partials, and
 * the difference is only conventional placement.
 *
 * Used for go-to-definition on a target that does not exist yet: it names the file
 * the editor should offer to create.
 */
export function nameToCreationPath(
  fileType: PlatformOSFileType,
  name: string,
  dirIndex = 0,
): string | undefined {
  // A fixed-path file has exactly one location, so "where would it be created" and
  // "where does it live" are the same answer — and there is no dirIndex or module form
  // to choose between.
  if (isFixedPathFileType(fileType)) {
    const [only] = nameToPaths(fileType, name);
    return only;
  }

  const dir = FILE_TYPE_DIRS[fileType]?.[dirIndex];
  if (dir === undefined) return undefined;

  const parsed = parseModulePrefix(name);
  const base = parsed.isModule
    ? `modules/${parsed.moduleName}/${ACCESS_LEVELS[0]}/${dir}`
    : getAppDirPath(dir);
  const [extension = ''] = REFERENCE_EXTENSIONS[fileType] ?? [];

  return `${base}/${parsed.key}${extension}`;
}

/**
 * `rest` without the extension a reference of this type omits.
 *
 * Only the LAST extension goes, so `api/users.json.liquid` is referenced as
 * `api/users.json` — the format suffix is part of the name, not decoration. Asset
 * names keep their extension entirely.
 */
function stripReferenceExtension(fileType: PlatformOSFileType, rest: string): string {
  if (!REFERENCE_EXTENSIONS[fileType]) return rest;

  const withoutExtension = stripLastSegment(rest);
  if (!FORMAT_BEARING_TYPES.has(fileType)) return withoutExtension;

  // `1col.html.liquid` → `1col`: the response format is not part of the name a
  // reference uses. Only a KNOWN format is stripped, so a partial legitimately called
  // `user.avatar.liquid` keeps its dot.
  const format = withoutExtension.slice(withoutExtension.lastIndexOf('.') + 1);
  return KNOWN_FORMATS.has(format) ? stripLastSegment(withoutExtension) : withoutExtension;
}

/** `path` without its last dot-separated segment, if it has one after the last slash. */
function stripLastSegment(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  const lastDot = path.lastIndexOf('.');
  return lastDot > lastSlash ? path.slice(0, lastDot) : path;
}

/**
 * The translations base directory a translation file belongs to, expressed
 * relative to the project root, or `undefined` when the path is not a translation
 * file.
 *
 * Translations are the one file type whose SCOPE matters as much as its type: keys
 * are merged and compared per base directory, so the app's translations and each
 * module's are separate sets. The directory name comes from `FILE_TYPE_DIRS`, so
 * callers never spell it themselves.
 *
 * @example getTranslationBase('app/translations/pt-BR.yml')            // → 'app/translations'
 * @example getTranslationBase('app/translations/pt-BR/validation.yml') // → 'app/translations'
 * @example getTranslationBase('modules/x/public/translations/en.yml')  // → 'modules/x/public/translations'
 */
export function getTranslationBase(relativePath: string): string | undefined {
  for (const dir of FILE_TYPE_DIRS[PlatformOSFileType.Translation]) {
    const marker = `/${dir}/`;
    const index = relativePath.lastIndexOf(marker);
    if (index !== -1) return relativePath.slice(0, index + marker.length - 1);
  }
  return undefined;
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
