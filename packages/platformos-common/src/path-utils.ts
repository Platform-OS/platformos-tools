/**
 * Identifies platformOS file types from their paths.
 *
 * Source of truth: `app/services/app_builder/services/converters_config.rb` and
 * `app/models/concerns/deployable.rb` in the platformOS server codebase, whose
 * `DIR_PREFIX` is `^/?((marketplace_builder|app)/|modules/(.+)(private|public)/)?` —
 * so an app file lives under `app/{dir}/`, `marketplace_builder/{dir}/` (legacy alias),
 * or `[app/]modules/{name}/(public|private)/{dir}/`.
 */

import { UriString } from './AbstractFileSystem';
import { sourceCodeTypeOf } from './app/types';
import { relativeUriPath } from './app/uri';
import { KNOWN_FORMATS } from './route-table/slugFromFilePath';

/**
 * File types that exist in a platformOS app, each corresponding to a server-side
 * converter that processes the file on deploy.
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
 * the filename each is. These have no `{dir}` and no `{rest}`, which is why they are
 * not in {@link FILE_TYPE_DIRS}.
 *
 * App-scoped only — there is no `modules/<name>/{public,private}/config.yml`. Ruby's
 * `App::CONFIG_REGEX` and `USER_SCHEMA_REGEX` are the only `REGEXP_MAP` entries whose
 * prefix alternation omits the `modules/` branch.
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
 * The single source of truth for the platformOS directory structure: each
 * DIRECTORY-based type's canonical directory name(s), plus the legacy aliases the
 * server's `converters_config.rb` `FULL_PHYSICAL_PATH` regexes still accept.
 *
 * Order matters across types — the first match wins, which is what keeps
 * `app/lib/smses/` a Partial rather than an Sms. Within a type, canonical first.
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
  [PlatformOSFileType.Table]: ['schema', 'custom_model_types', 'model_schemas'],
  [PlatformOSFileType.UserProfileType]: [
    'user_profile_types',
    'instance_profile_types',
    'user_profile_schemas',
  ],
  [PlatformOSFileType.TransactableType]: ['transactable_types'],
  [PlatformOSFileType.Translation]: ['translations'],
  // activity_streams/handler.rb:5 and activity_streams/grouping_handler.rb:5
  [PlatformOSFileType.ActivityStreamsHandler]: ['activity_streams/handlers'],
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: ['activity_streams/grouping_handlers'],
  // GraphQL
  // Deliberate deviation: graph_query.rb:5 is `(graph_queries|graphql)s?/`, so the platform
  // also accepts `graphqls/`. A fourth spelling costs four more candidate paths on every
  // unresolved `{% graphql %}` and no real project uses it.
  [PlatformOSFileType.GraphQL]: ['graphql', 'graph_queries'],
  // Asset
  [PlatformOSFileType.Asset]: ['assets'],
};

/**
 * The backend's own name for a file type, as it appears in the Liquid docset's
 * `access.app_file_type` — singular snake_case, where {@link FILE_TYPE_DIRS} holds the
 * plural DIRECTORY spellings of the same set.
 *
 * Only the Liquid types a documented object can belong to need an entry.
 */
const APP_FILE_TYPE_NAMES: Readonly<Partial<Record<PlatformOSFileType, string>>> = {
  [PlatformOSFileType.Page]: 'page',
  [PlatformOSFileType.Layout]: 'layout',
  [PlatformOSFileType.Partial]: 'partial',
  [PlatformOSFileType.Authorization]: 'authorization_policy',
  [PlatformOSFileType.Email]: 'email',
  [PlatformOSFileType.ApiCall]: 'api_call',
  [PlatformOSFileType.Sms]: 'sms',
  [PlatformOSFileType.Migration]: 'migration',
  [PlatformOSFileType.FormConfiguration]: 'form_configuration',
};

const FILE_TYPE_BY_APP_FILE_TYPE: ReadonlyMap<string, PlatformOSFileType> = new Map(
  Object.entries(APP_FILE_TYPE_NAMES).map(([fileType, name]) => [
    name,
    fileType as PlatformOSFileType,
  ]),
);

/**
 * The `PlatformOSFileType` a docset `access.app_file_type` names, or `undefined` when this
 * version has no entry for it. A caller must treat `undefined` as "unknown", never as a
 * mismatch — a docset naming a file type we have not heard of is not evidence about scope.
 */
export function appFileTypeToFileType(appFileType: string): PlatformOSFileType | undefined {
  return FILE_TYPE_BY_APP_FILE_TYPE.get(appFileType);
}

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
 * — so `app/translations/en.yaml` is not deployed.
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
 * `instance_view.rb:8` defines an unused `EXTENSION = '.liquid'` beside the regexp. The
 * regexp is what runs.
 */
const EXTENSION_AGNOSTIC_TYPES = new Set<PlatformOSFileType>([
  PlatformOSFileType.Page,
  PlatformOSFileType.Layout,
  PlatformOSFileType.Partial,
  PlatformOSFileType.Asset,
]);

/**
 * The regexp fragment that pins `type`'s extension, or `''` when any extension
 * classifies. This is what makes a known directory NOT enough on its own:
 * `app/graphql/x.yml` and `app/translations/en.json` classify as nothing.
 */
function extensionPattern(type: PlatformOSFileType): string {
  if (EXTENSION_AGNOSTIC_TYPES.has(type)) return '';
  const extensions = REFERENCE_EXTENSIONS[type];
  if (extensions === undefined || extensions.length === 0) return '';
  return `\\.(?:${extensions.map((extension) => extension.slice(1)).join('|')})`;
}

/**
 * What the platform does with the file at `uri`, or `undefined` when it does
 * nothing with it — the file is not part of the app.
 *
 * **`rootUri` is required, and that is the point.** A platformOS file is one whose
 * position RELATIVE TO THE PROJECT ROOT matches the directory structure, so a
 * classifier without a root can only test whether a known directory name appears
 * somewhere in the string, which is a different and wrong question:
 * `seed/post_import/app/migrations/x.liquid` contains `app/migrations/` and is not a
 * migration, so every diagnostic produced for it is noise about a file the platform
 * will never run.
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
  // A fixed-path type has no directory, so no search paths.
  return (FILE_TYPE_DIRS[type] ?? []).map(getAppDirPath);
}

/**
 * {@link getAppPaths} across EVERY app root, the legacy `marketplace_builder`
 * included, canonical root wholly first — for a caller LOCATING what a project
 * already has (which root holds its reference translations, say). A caller NAMING
 * where a new file belongs wants {@link getAppPaths}, which answers with the
 * canonical root only.
 *
 * @example
 * getAppPathsAcrossRoots(PlatformOSFileType.Translation)
 * // → ['app/translations', 'marketplace_builder/translations']
 */
export function getAppPathsAcrossRoots(type: PlatformOSFileType): string[] {
  return APP_ROOTS.flatMap((root) => (FILE_TYPE_DIRS[type] ?? []).map((dir) => `${root}/${dir}`));
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
 * root). For a `PlatformOSFileType` prefer {@link getAppPaths}; this is for callers
 * handed a directory name rather than a type, e.g. frontmatter association keys.
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
 * and `AppPathInfo.searchPathIndex` both derive from it, so a name index and a
 * candidate-path walk cannot disagree about which file a name resolves to.
 */
export function getModuleDirPaths(dir: string, moduleName: string): string[] {
  return MODULE_ROOTS.flatMap((root) =>
    ACCESS_LEVELS.map((access) => `${root}/${moduleName}/${access}/${dir}`),
  );
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
 * **There is deliberately no third clause.** Do not add an exclusion list here: an
 * ignore-list in one predicate is only consulted by that predicate's callers, whereas
 * a file we cannot parse is one with no row in `SOURCE_CODE_TYPE_BY_KEY`, and absence
 * cannot be forgotten.
 *
 * The two clauses answer genuinely different questions and neither implies the other.
 * `app/views/pages/home.html` is a Page the platform deploys (1 yes, 2 no); a
 * `.liquid` file in `scripts/` parses fine and is not deployed (2 yes, 1 no).
 */
export function isSupportedSourceFile(uri: UriString, rootUri: UriString): boolean {
  return getFileType(uri, rootUri) !== undefined && sourceCodeTypeOf(uri) !== undefined;
}

/**
 * One-type convenience wrappers over {@link getFileType}.
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

// ─── Structured path parsing ──────────────────────────────────────────────────

/**
 * The roots an app-level file can live under. `app/` is canonical;
 * `marketplace_builder` is legacy and the backend still accepts it (`deployable.rb:21`),
 * so it stays — dropping a live root makes a project on it lint nothing at all,
 * silently.
 *
 * Exported for callers that must RECOGNIZE a root — check-common's `findRoot` marks a
 * directory as a project root because it contains one of these — which cannot spell
 * the names themselves. `findRoot` hardcoded `app`, and a legacy project without a
 * `.pos` or config file resolved no root at all: no diagnostics, no completions, and
 * nothing to say why.
 */
export const APP_ROOTS = ['app', 'marketplace_builder'] as const;

/**
 * The roots modules live under, in resolution order: an `app/modules/<name>` copy
 * shadows the `modules/<name>` original of the same name.
 *
 * Exported for callers that need to ENUMERATE modules, which `getModulePaths` cannot
 * do since it needs a name.
 */
export const MODULE_ROOTS = ['app/modules', 'modules'] as const;

/** The access levels a module directory is split into. */
const ACCESS_LEVELS = ['public', 'private'] as const;

export type AppRoot = (typeof APP_ROOTS)[number];
export type ModuleAccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * The module roots that are top-level directories of a project (`modules/`), not
 * nested under an app root — `app/modules/…` is covered by walking (or probing)
 * `app/` itself. The subtree walk and check-common's `findRoot` root markers both
 * derive from this, so they cannot disagree about which module directories stand
 * on their own.
 */
export const STANDALONE_MODULE_ROOTS: readonly string[] = MODULE_ROOTS.filter(
  (root) => !APP_ROOTS.some((appRoot) => root.startsWith(`${appRoot}/`)),
);

/**
 * The subtrees of a project, relative to its root, that an app file can live in.
 * `*` is exactly one path segment — a module name.
 *
 * This is {@link parseAppPath}'s grammar stated as a prefix, so it is the ONLY thing a
 * project walk needs in order to skip everything else. Do not replace it with a
 * directory-name blacklist (`node_modules`, `dist`, `tmp`, `vendor`, …), which is
 * wrong both ways: `tmp/app/views/partials/x.liquid` is not a partial, and
 * `app/views/pages/vendor/x.liquid` IS a page that any `vendor` blacklist loses.
 *
 * `app/modules/<name>/…` needs no entry of its own: it is under `app`.
 */
export const APP_SOURCE_SUBTREES: readonly string[] = [
  ...APP_ROOTS,
  ...STANDALONE_MODULE_ROOTS.flatMap((root) =>
    ACCESS_LEVELS.map((access) => `${root}/*/${access}`),
  ),
];

/**
 * Everything the directory structure says about one file, resolved in a single
 * anchored pass over {@link FILE_TYPE_DIRS}.
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
   * `undefined` when it lives under a root those never search (the legacy
   * `marketplace_builder/`).
   *
   * This is what lets a name index reproduce "first candidate path that exists wins"
   * as a comparison instead of a sequence of `stat` calls.
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
    // Inside the `rest` capture, not after it: `rest` keeps its extension.
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

  // Fixed-path files are checked first: they have no directory segment for the patterns
  // below to match against, so `dir` is empty and `rest` is the filename itself.
  // Compared as strings rather than by regex — this runs once per file in the project.
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
        // getAppPaths() only searches `app/`, so a marketplace_builder file has no
        // position in the walk.
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
 * the enum.
 */
export function getReferenceExtensions(fileType: PlatformOSFileType): readonly string[] {
  return REFERENCE_EXTENSIONS[fileType] ?? [];
}

/**
 * Every extension a platformOS SOURCE file can have — what a project walk has to
 * collect for the app to be complete.
 *
 * Derived from {@link REFERENCE_EXTENSIONS}, so adding a file type gives the walkers
 * its extension for free. Assets are absent for the same reason they are absent there:
 * they carry their own extension, are never parsed, and nothing lints them.
 *
 * A consumer collecting these still gets a superset of the app — `bin/deploy.yml` has a
 * source extension and is not a platformOS file. What a path IS remains
 * {@link parseAppPath}'s answer.
 */
export const SOURCE_FILE_EXTENSIONS: readonly string[] = [
  ...new Set(Object.values(REFERENCE_EXTENSIONS).flat()),
];

/** `a` for one alternative, `{a,b}` for several — a one-entry `{a}` reads like a typo. */
function braceGroup(alternatives: readonly string[]): string {
  return alternatives.length === 1 ? alternatives[0] : `{${alternatives.join(',')}}`;
}

/** Just the filename half of {@link SOURCE_FILE_GLOB}, for a caller that anchors its own directory. */
const SOURCE_FILE_NAME_GLOB = `*.${braceGroup(
  SOURCE_FILE_EXTENSIONS.map((extension) => extension.slice(1)),
)}`;

/**
 * {@link SOURCE_FILE_EXTENSIONS} as a brace-expansion glob, matching every source file
 * at any depth below wherever it is anchored.
 *
 * Deliberately NOT anchored to `app/`: a consumer joins it onto whatever root or subtree
 * it is walking ({@link APP_SOURCE_SUBTREES} for the lint), or uses it as-is where the
 * pattern is already relative to the workspace root (the LSP).
 */
export const SOURCE_FILE_GLOB = `**/${SOURCE_FILE_NAME_GLOB}`;

/**
 * Every path form an app file's DIRECTORY can take, as globs: the two app roots, and
 * a module's two access levels under each module root.
 *
 * Each brace group holds a single path segment. That is not cosmetic — the LSP's glob
 * syntax promises `*`, `?`, `**`, `[]` and `{}`, and says nothing about a `{}` whose
 * alternatives contain `/`, so a client that quietly failed to match one would give us
 * a watcher that misses files with no symptom. Hence `app/modules` as a literal prefix
 * rather than an alternative next to `modules`.
 */
const APP_PATH_ROOT_GLOBS: readonly string[] = [
  braceGroup(APP_ROOTS),
  ...MODULE_ROOTS.map((root) => `${root}/*/${braceGroup(ACCESS_LEVELS)}`),
];

/**
 * {@link FILE_TYPE_DIRS}' directories as globs, one per parent directory, with the
 * leaf names brace-grouped: `views/{layouts,pages,partials}`, and a bare group for
 * the directories that sit directly under a root.
 *
 * Grouping by parent is what keeps every brace group slash-free (see
 * {@link APP_PATH_ROOT_GLOBS}) while turning 28 directories into 4 patterns.
 *
 * `assets` is deliberately absent. Nothing reads an asset, so the only question ever
 * asked about one is whether it exists, and `DocumentsLocator` answers that with a
 * `stat` rather than from the index so it cannot go stale. Watching them would deliver
 * an event per image and buy nothing.
 */
const APP_FILE_TYPE_DIR_GLOBS: readonly string[] = (() => {
  const leavesByParent = new Map<string, string[]>();

  for (const [fileType, dirs] of Object.entries(FILE_TYPE_DIRS)) {
    if (fileType === PlatformOSFileType.Asset) continue;
    for (const dir of dirs) {
      const cut = dir.lastIndexOf('/');
      const parent = cut === -1 ? '' : dir.slice(0, cut);
      const leaf = cut === -1 ? dir : dir.slice(cut + 1);
      const leaves = leavesByParent.get(parent) ?? [];
      if (!leaves.includes(leaf)) leaves.push(leaf);
      leavesByParent.set(parent, leaves);
    }
  }

  return [...leavesByParent].map(([parent, leaves]) =>
    parent ? `${parent}/${braceGroup(leaves)}` : braceGroup(leaves),
  );
})();

/**
 * The globs a file watcher needs in order to see every change that can affect an
 * `App`, anchored on the directories an app file can actually be in.
 *
 * This is `parseAppPath`'s grammar as globs, derived from the same three tables it
 * reads — {@link FILE_TYPE_DIRS}, {@link APP_ROOTS}/{@link MODULE_ROOTS}, and
 * {@link SOURCE_FILE_EXTENSIONS} — so a new file type or directory alias is watched
 * by adding it there and nowhere else. Do not respell it in a consumer.
 *
 * Anchoring is the point: an unanchored `**` /`*.liquid` delivers every generator
 * template, build artifact, seed and `node_modules` copy in the repository, each read
 * before the server finds out it was not an app file.
 *
 * The two fixed files are here because they live directly under `app/` rather than in
 * a type directory, so no directory glob covers them, and `app/config.yml` in
 * particular is what the server watches to know its `theme_search_paths` changed.
 */
export const APP_WATCH_GLOBS: readonly string[] = [
  ...APP_FILE_TYPE_DIR_GLOBS.flatMap((dirs) =>
    APP_PATH_ROOT_GLOBS.map((root) => `${root}/${dirs}/**/${SOURCE_FILE_NAME_GLOB}`),
  ),
  ...Object.values(PlatformOSFileType)
    .map((fileType) => getFixedFilePath(fileType))
    .filter((fixedPath): fixedPath is string => fixedPath !== undefined),
];

/**
 * Assets in the shape a client-side FILE-OPERATION filter (rename notifications)
 * needs them: every file at any depth under any `assets/` directory — `**` on the
 * file side because assets nest (`assets/js/app.js`). They are absent from
 * {@link APP_WATCH_GLOBS} because nothing reads one — but a RENAME changes what
 * an asset reference resolves to, so those events matter.
 *
 * Root-agnostic deliberately: such a filter has no workspace anchor to spell `app/`
 * against, and a `**`-rooted glob matches the directory under every legal root, so it
 * cannot disagree with the placement rule (`directory-knowledge.spec` exempts exactly
 * this shape). The server re-anchors with `getFileType` before acting on an event.
 */
export const ASSET_FILE_OPERATION_GLOB = `**/${braceGroup(
  FILE_TYPE_DIRS[PlatformOSFileType.Asset],
)}/**`;

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
 * The format spellings {@link nameToPaths} enumerates: plain first, then every
 * {@link KNOWN_FORMATS} entry, `html` leading because it is what the documented
 * layout and partial examples carry.
 *
 * EVERY format, deliberately, to stay the exact inverse of `pathToName`, which strips
 * ANY known format. Enumerating them costs nothing: `App.findOrLocate`'s miss path
 * lists each candidate DIRECTORY once and matches names against the listing, so
 * covering twelve formats is the same I/O as covering one.
 */
const FORMAT_SUFFIXES: readonly string[] = [
  '',
  ...[...KNOWN_FORMATS].map((format) => `.${format}`),
];

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
 * a file on disk. Every caller that needs either direction must go through them.
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
 * {@link pathToName} for a caller holding a URI and its root rather than a
 * root-relative path — `AppFile#name`'s derivation without an `App` in hand
 * (a rename handler's deleted old URI, say). Both URIs are normalized, so a
 * trailing-slash or differently-spelled root cannot change the answer.
 */
export function uriToName(uri: UriString, rootUri: UriString): LogicalName | undefined {
  return pathToName(relativeUriPath(uri, rootUri));
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

  // A fixed-path file has one name and one path and no module form, which the directory
  // machinery below cannot express because there is no directory.
  const fixedPath = getFixedFilePath(fileType);
  if (fixedPath !== undefined) {
    return !parsed.isModule && parsed.key === fixedNameOf(fileType) ? [fixedPath] : [];
  }

  const searchPaths = parsed.isModule
    ? getModulePaths(fileType, parsed.moduleName)
    : getAppPaths(fileType);
  const extensions = REFERENCE_EXTENSIONS[fileType] ?? [''];
  const suffixes = FORMAT_BEARING_TYPES.has(fileType) ? FORMAT_SUFFIXES : [''];

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
 * Where a file called `name` WOULD be created, for go-to-definition on a target that
 * does not exist yet — not the same question as where it is looked for.
 *
 * {@link nameToPaths} orders candidates so the file that already exists wins, which puts
 * the `app/modules/<name>` OVERWRITE slot first. Creation is the opposite: a new module
 * file belongs in the module itself (`modules/<name>/public/…`).
 *
 * `dirIndex` selects among a type's directory aliases, which is how `function` lands
 * in `app/lib` while `render` lands in `app/views/partials`.
 */
export function nameToCreationPath(
  fileType: PlatformOSFileType,
  name: string,
  dirIndex = 0,
): string | undefined {
  // A fixed-path file has exactly one location, so both questions have one answer.
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
 * Where a file's format spelling sits among the candidates {@link nameToPaths}
 * emits for one directory: `0` for the plain spelling, `1` for `.html`, and so on
 * through {@link KNOWN_FORMATS}.
 *
 * This is the tiebreak `App`'s name index uses between two files of the SAME name
 * in the SAME directory — `card.liquid` against `card.json.liquid` — so that the
 * index and a walk over `nameToPaths`' candidates pick the same winner.
 *
 * `rest` is the path below the type directory, extension intact, i.e.
 * {@link AppPathInfo.rest}.
 */
export function formatRank(fileType: PlatformOSFileType, rest: string): number {
  if (!FORMAT_BEARING_TYPES.has(fileType) || !REFERENCE_EXTENSIONS[fileType]) return 0;
  const withoutExtension = stripLastSegment(rest);
  // A format is a DOTTED segment after the basename starts, so a file whose plain
  // basename IS a format word (`json.liquid`) does not rank as if it carried the suffix.
  const lastSlash = withoutExtension.lastIndexOf('/');
  const lastDot = withoutExtension.lastIndexOf('.');
  if (lastDot <= lastSlash) return 0;
  const index = FORMAT_SUFFIXES.indexOf(withoutExtension.slice(lastDot));
  return index === -1 ? 0 : index;
}

/**
 * The translations base directory a translation file belongs to, expressed
 * relative to the project root, or `undefined` when the path is not a translation
 * file.
 *
 * Translations are the one file type whose SCOPE matters as much as its type: keys
 * are merged and compared per base directory, so the app's translations and each
 * module's are separate sets.
 *
 * ANCHORED, like every other question about a path: the answer is
 * {@link parseAppPath}'s classification with the part below the type directory cut
 * off, so a path is a translation file exactly when the app model says it is one.
 *
 * @example getTranslationBase('app/translations/pt-BR.yml')            // → 'app/translations'
 * @example getTranslationBase('app/translations/pt-BR/validation.yml') // → 'app/translations'
 * @example getTranslationBase('modules/x/public/translations/en.yml')  // → 'modules/x/public/translations'
 */
export function getTranslationBase(relativePath: string): string | undefined {
  const info = parseAppPath(relativePath);
  if (info?.fileType !== PlatformOSFileType.Translation) return undefined;
  // `rest` is a suffix of the path by construction, so cutting it (and its slash) off the
  // original string preserves whatever leading-slash spelling the caller used.
  return relativePath.slice(0, relativePath.length - info.rest.length - 1);
}

// ─── Module prefix utilities ──────────────────────────────────────────────────

/**
 * Result of parsing a `modules/{name}/...` prefix from a path or key.
 * Used by DocumentsLocator and TranslationProvider to route lookups to the
 * correct module directory.
 */
export type ModulePrefix =
  { isModule: false; key: string } | { isModule: true; moduleName: string; key: string };

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
