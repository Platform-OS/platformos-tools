import { AugmentedPlatformOSDocset } from './AugmentedPlatformOSDocset';
import { JSONValidator } from './JSONValidator';
import {
  makeFileExists,
  makeFileSize,
  makeGetDefaultLocale,
  makeGetDefaultTranslations,
  makeGetRouteTable,
  makeGetTranslationsForBase,
} from './context-utils';
import { createDisabledChecksModule } from './disabled-checks';
import { isIgnored } from './ignore';
import * as path from './path';
import {
  AugmentedDependencies,
  Check,
  CheckDefinition,
  CheckSettings,
  Config,
  Context,
  Dependencies,
  GraphQLCheck,
  GraphQLDocumentNode,
  GraphQLSourceCode,
  JSONCheck,
  JSONNode,
  JSONSourceCode,
  LiquidCheck,
  LiquidHtmlNode,
  LiquidSourceCode,
  Offense,
  Problem,
  Schema,
  Settings,
  SourceCode,
  SourceCodeType,
  App,
  UriString,
  ValidateJSON,
  YAMLCheck,
  YAMLSourceCode,
} from './types';
import { getPosition } from './utils';
import { visitJSON, visitLiquid } from './visitors';

// `getPosition` (source + 0-based offset → { line, character }) is the canonical
// offset→position utility used by `check()` itself; re-exported so sibling
// consumers (e.g. the MCP supervisor mapping graph references) reuse it instead
// of re-counting newlines.
export { getPosition } from './utils';

// `levenshtein` (edit distance) is re-exported so sibling consumers (e.g. the
// graph's nearest-name "did you mean" candidates) reuse it rather than
// re-implementing string-distance.
export { levenshtein } from './utils';

// `isTranslationKeyUsage` is the shared predicate for "a string literal piped
// through `t`/`translate`"; exported so the graph's self-structural detects
// translation keys with the SAME rule as the `TranslationKeyExists` check.
export { isTranslationKeyUsage, TRANSLATION_FILTERS } from './translation-usage';

export * from './AugmentedPlatformOSDocset';
export * from './types/platformos-liquid-docs';
export * from './checks';
export * from './context-utils';
export * from './find-root';
export * from './fixes';
export * from './ignore';
export {
  FILE_TYPE_DIRS,
  getAppPaths,
  getFileType,
  getModulePaths,
  isApiCall,
  isAuthorization,
  isEmail,
  isFormConfiguration,
  isKnownGraphQLFile,
  isKnownLiquidFile,
  isKnownYAMLFile,
  isLayout,
  isMigration,
  isPage,
  isPartial,
  isSms,
  isSupportedSourceFile,
  PlatformOSFileType,
} from '@platformos/platformos-common';
export * from './frontmatter';
export * from './json';
export * from './JSONValidator';
export * as path from './path';
export * from './to-source-code';
export * from './types';
export * from './utils/bounded-cache';
export * from './utils/error';
export * from './utils/graphql-schema';
export * from './utils/indexBy';
export * from './utils/memo';
export * from './utils/types';
export * from './utils/object';
export * from './visitor';
export * from './liquid-doc/liquidDoc';
export * from './liquid-doc/utils';
export * from './url-helpers';

const defaultErrorHandler = (_error: Error): void => {
  // Silently ignores errors by default.
};

/** Optional narrowing of a {@link check} run. */
export interface CheckOptions {
  /**
   * Visit ONLY these files (normalized `file://` URIs), instead of every file in
   * `app`. Omit to visit everything, which is the whole-project behaviour every
   * caller had before this option existed.
   *
   * `app` must STILL be the complete project: the cross-file dependencies built
   * below (`getDefaultTranslations`, `getTranslationsForBase`, `getRouteTable`,
   * `fileExists`) are derived from it, and that is how cross-file checks
   * (`MissingPartial`, `OrphanedPartial`, `TranslationKeyExists`, …) resolve the
   * rest of the project. This option narrows what gets VISITED, never what the
   * checks can see.
   *
   * The result is exactly the subset of the unrestricted run's offenses that
   * belongs to these files, because an offense's `uri` is always the visited
   * file's `uri` (see `report` in `createContext` — the single place offenses are
   * created). It is therefore a performance option, not a semantic one: linting
   * one buffer in a 1400-file project drops from ~21 s to ~0.1 s.
   */
  only?: UriString[];
}

export async function check(
  app: App,
  config: Config,
  injectedDependencies: Dependencies,
  options: CheckOptions = {},
): Promise<Offense[]> {
  const pipelines: Promise<void>[] = [];
  const offenses: Offense[] = [];
  const { fs } = injectedDependencies;
  const { rootUri } = config;
  const dependencies: AugmentedDependencies = {
    ...injectedDependencies,
    fileExists: makeFileExists(fs),
    fileSize: makeFileSize(fs),
    getDefaultLocale: makeGetDefaultLocale(fs, rootUri),
    getDefaultTranslations: makeGetDefaultTranslations(fs, app, rootUri),
    getTranslationsForBase: makeGetTranslationsForBase(fs, app),
    getRouteTable: makeGetRouteTable(fs, rootUri, injectedDependencies.routeTable),
  };

  const { DisabledChecksVisitor, isDisabled } = createDisabledChecksModule();
  const jsonValidator = await JSONValidator.create(dependencies.jsonValidationSet, config);
  const validateJSON = jsonValidator?.validate;

  // We're memozing those deps here because they shouldn't change within a run.
  if (dependencies.platformosDocset && !dependencies.platformosDocset.isAugmented) {
    dependencies.platformosDocset = new AugmentedPlatformOSDocset(dependencies.platformosDocset);
  }

  for (const type of Object.values(SourceCodeType)) {
    switch (type) {
      case SourceCodeType.JSON: {
        const files = filesToVisit(filesOfType(type, app), options.only);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(checkJSONFile(check, file));
          }
        }
        break;
      }
      case SourceCodeType.GraphQL: {
        const files = filesToVisit(filesOfType(type, app), options.only);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(checkGraphQLFile(check, file));
          }
        }
        break;
      }
      case SourceCodeType.LiquidHtml: {
        const files = filesToVisit(filesOfType(type, app), options.only);
        const checkDefs = [DisabledChecksVisitor, ...checksOfType(type, config.checks)];
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(checkLiquidFile(check, file));
          }
        }
        break;
      }
      case SourceCodeType.YAML: {
        const files = filesToVisit(filesOfType(type, app), options.only);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(checkYAMLFile(check, file));
          }
        }
        break;
      }
    }
  }

  const onRejected = config.onError || defaultErrorHandler;
  await Promise.all(pipelines.map((pipeline) => pipeline.catch(onRejected)));

  return offenses.filter((offense) => !isDisabled(offense));
}

function createContext<T extends SourceCodeType, S extends Schema>(
  check: CheckDefinition<T, S>,
  file: SourceCode<T>,
  offenses: Offense[],
  config: Config,
  dependencies: Dependencies,
  validateJSON?: ValidateJSON,
): Context<T, S> {
  const checkSettings = config.settings[check.meta.code];
  return {
    ...dependencies,
    validateJSON,
    settings: createSettings(checkSettings, check.meta.schema),
    toUri: (relativePath) => path.join(config.rootUri, ...relativePath.split('/')),
    toRelativePath: (uri) => path.relative(uri, config.rootUri),
    report(problem: Problem<T>): void {
      offenses.push({
        type: check.meta.type,
        check: check.meta.code,
        message: problem.message,
        uri: file.uri,
        severity: checkSettings?.severity ?? check.meta.severity,
        start: getPosition(file.source, problem.startIndex),
        end: getPosition(file.source, problem.endIndex),
        fix: problem.fix,
        suggest: problem.suggest,
      } as Offense<T> as Offense);
    },
    file,
    config,
  } as Context<T, S>;
}

function createSettings<S extends Schema>(
  checkSettings: CheckSettings | undefined,
  schema: S,
): Settings<S> {
  const settings: Partial<Settings<S>> = {};

  for (const [key, schemaProp] of Object.entries(schema)) {
    settings[key as keyof S] = checkSettings?.[key] ?? schemaProp.defaultValue();
  }

  return settings as Settings<S>;
}

function checksOfType<S extends SourceCodeType>(
  type: S,
  checks: CheckDefinition<SourceCodeType>[],
): CheckDefinition<S>[] {
  return checks.filter((def): def is CheckDefinition<S> => def.meta.type === type);
}

function createCheck<S extends SourceCodeType>(
  check: CheckDefinition<S>,
  file: SourceCode<S>,
  config: Config,
  offenses: Offense[],
  dependencies: Dependencies,
  validateJSON?: ValidateJSON,
): Check<S> {
  const context = createContext(check, file, offenses, config, dependencies, validateJSON);
  return check.create(context as any) as Check<S>;
}

/**
 * The files a run should visit: all of them, or just the ones {@link CheckOptions.only}
 * names. Unknown URIs in `only` simply match nothing (a buffer for a file that is
 * not part of the app yields no offenses, same as before).
 */
function filesToVisit<T extends SourceCodeType>(
  files: SourceCode<T>[],
  only?: UriString[],
): SourceCode<T>[] {
  if (!only) return files;

  const visit = new Set(only);
  return files.filter((file) => visit.has(file.uri));
}

function filesOfType<S extends SourceCodeType>(type: S, sourceCodes: App): SourceCode<S>[] {
  return sourceCodes.filter((file): file is SourceCode<S> => file.type === type);
}

async function checkJSONFile(check: JSONCheck, file: JSONSourceCode): Promise<void> {
  if (check.onCodePathStart) await check.onCodePathStart(file);
  if (file.ast instanceof Error) return;
  if (Object.keys(check).length > 0) await visitJSON(file.ast, check);
  if (check.onCodePathEnd) await check.onCodePathEnd(file as typeof file & { ast: JSONNode });
}

async function checkGraphQLFile(check: GraphQLCheck, file: GraphQLSourceCode): Promise<void> {
  if (check.onCodePathEnd)
    await check.onCodePathEnd(file as typeof file & { ast: GraphQLDocumentNode });
}

async function checkLiquidFile(check: LiquidCheck, file: LiquidSourceCode): Promise<void> {
  if (check.onCodePathStart) await check.onCodePathStart(file);
  if (file.ast instanceof Error) return;
  if (Object.keys(check).length > 0) await visitLiquid(file.ast, check);
  if (check.onCodePathEnd) await check.onCodePathEnd(file as typeof file & { ast: LiquidHtmlNode });
}

async function checkYAMLFile(check: YAMLCheck, file: YAMLSourceCode): Promise<void> {
  if (check.onCodePathStart) await check.onCodePathStart(file);
  if (file.ast instanceof Error) return;
  if (Object.keys(check).length > 0) await visitJSON(file.ast, check as any);
  if (check.onCodePathEnd) await check.onCodePathEnd(file as typeof file & { ast: JSONNode });
}
