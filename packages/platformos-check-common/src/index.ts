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
import { getFileType as commonGetFileType } from '@platformos/platformos-common';
import {
  AppModel,
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
  Severity,
  SourceAppFile,
  SourceCode,
  SourceCodeType,
  TypedAppFile,
  UriString,
  ValidateJSON,
  YAMLCheck,
  YAMLSourceCode,
} from './types';
import { getPosition } from './utils';
import { visitJSON, visitLiquid } from './visitors';

export * from './AugmentedPlatformOSDocset';
export * from './types/platformos-liquid-docs';
export * from './checks';
export * from './context-utils';
export * from './find-root';
export * from './fixes';
export * from './ignore';
// No file-identity re-exports. platformos-common is the SINGLE owner of what a
// path is — `getFileType`, `nameToPaths`, `parseAppPath`, the directory tables —
// and consumers import those from it directly, so an import line says which layer
// owns the fact. `identity-ownership.spec.ts` fails on any that grow back here.
export * from './frontmatter';
export * from './json';
export * from './JSONValidator';
export * as path from './path';
export * from './to-source-code';
export * from './types';
export * from './utils/bounded-cache';
export * from './utils/error';
// NOT `./utils/graphql-schema`: a schema is only inspectable by the `graphql`
// module record that built it, so consumers must build their own. See that file.
export * from './utils/indexBy';
export * from './utils/memo';
export * from './utils/types';
export * from './utils/object';
export * from './visitor';
export * from './liquid-doc/liquidDoc';
export * from './liquid-doc/utils';
export * from './url-helpers';
// ONE answer to "what shape does this variable have". `UnknownProperty` is its first
// consumer, not its owner: the language server asks the same question for hover and
// completion, and a second implementation of it is how the editor and the check came
// to disagree — the editor's copy offered a `relation` exactly one property.
export * from './checks/unknown-property/property-shape';
export * from './checks/unknown-property/shape-analysis';

const defaultErrorHandler = (_error: Error): void => {
  // Silently ignores errors by default. The offense recorded by `runPipeline` is what
  // keeps that from reading as a clean file.
};

/** The check code an internal failure is reported under. Never a real check's code. */
export const CHECK_ERROR_CODE = 'CheckError';

/** Optional narrowing of a {@link check} run. */
export interface CheckOptions {
  /**
   * Visit ONLY these files (normalized `file://` URIs), instead of every file in
   * `app`. Omit (or pass `undefined`) to visit everything, which is the
   * whole-project behaviour every caller had before this option existed.
   *
   * The list is taken literally: `[]` names no files and so visits none, and the
   * run reports no offenses. A caller that computes this list must therefore
   * decide for itself what an empty result means — passing `[]` to mean "the
   * whole project" would silently lint nothing.
   *
   * `app` must STILL be the complete project. `getDefaultTranslations`,
   * `getTranslationsForBase` and check-node's `getDocDefinition` are all built from
   * it, and are how cross-file checks (`MissingPartial`, `MissingPage`,
   * `TranslationKeyExists`, …) resolve the rest of the project. This option
   * narrows what gets VISITED, never what the checks can see.
   *
   * The result is exactly the subset of the unrestricted run's offenses that
   * belongs to these files, because an offense's `uri` is always the visited
   * file's `uri` (see `report` in `createContext` — the single place offenses are
   * created). It is therefore a performance option, not a semantic one: on a
   * 1400-file project it takes the check phase from ~21 s to ~0.15 s.
   */
  only?: UriString[];
}

export async function check(
  app: AppModel,
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
    // Checks that resolve a name to a file take this and let the App's index answer,
    // rather than stat-ing candidate directories in order.
    app,
    fileExists: makeFileExists(fs),
    fileSize: makeFileSize(fs),
    getDefaultLocale: makeGetDefaultLocale(fs, rootUri),
    getDefaultTranslations: makeGetDefaultTranslations(fs, app, rootUri),
    getTranslationsForBase: makeGetTranslationsForBase(fs, app),
    getRouteTable: makeGetRouteTable(fs, rootUri, injectedDependencies.routeTable),
  };

  const { DisabledChecksVisitor, isDisabled } = createDisabledChecksModule();
  // Built on FIRST USE, not per run. No shipped check reads `context.validateJSON`
  // any more (ValidJSON and JSONSyntaxError went with the JSON source type), so
  // awaiting `jsonValidationSet.schemas()` here charged every run for a validator
  // nobody asked for. The seam stays — it is a documented Context capability and
  // `jsonValidationSet` is still a real dependency of the language server's JSON
  // services — it just costs nothing until a check asks again.
  const validateJSON = makeLazyValidateJSON(dependencies.jsonValidationSet, config);

  // We're memozing those deps here because they shouldn't change within a run.
  if (dependencies.platformosDocset && !dependencies.platformosDocset.isAugmented) {
    dependencies.platformosDocset = new AugmentedPlatformOSDocset(dependencies.platformosDocset);
  }

  const onRejected = config.onError || defaultErrorHandler;
  const visitable = filesToVisit(app, options.only);

  /**
   * One (check, file) pipeline, with its failure RECORDED rather than only handed to
   * `onError` — which no host sets, so it defaults to silence.
   *
   * A check that throws part-way through a file has already reported what it found
   * before the throw and will never report the rest, and a shrunken offense set reads
   * exactly like a clean file — so a check that dies analyzing one call site's target
   * silently passes the whole file.
   */
  const runPipeline = async (
    pipeline: Promise<void>,
    checkDef: CheckDefinition<SourceCodeType>,
    file: SourceCode<SourceCodeType>,
  ): Promise<void> => {
    try {
      await pipeline;
    } catch (error) {
      offenses.push(internalErrorOffense(checkDef, file, error));
      onRejected(error as Error);
    }
  };

  // The only place a run pays to read files. Everything visitable is read up
  // front — in parallel — so that from here on `file.source` and `file.ast` are
  // synchronous, which is what every check already assumes. Files that are merely
  // VISIBLE stay unread: a cross-file check that needs one of them awaits its
  // `load()` at the point it resolves it, and one that never resolves it never
  // costs a read or a parse.
  //
  // Per file, not per run. A bare `Promise.all` rejects on the first unreadable
  // file and takes every other file's diagnostics with it; the pipelines below
  // already route their failures to `onError` one at a time, and this is the same
  // rule applied to the read. A file whose read failed then throws from `source`
  // inside its own pipeline, which lands in the same place.
  await Promise.all(visitable.map((file) => file.load().catch(onRejected)));

  for (const type of Object.values(SourceCodeType)) {
    switch (type) {
      case SourceCodeType.JSON: {
        const files = filesOfType(type, visitable);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(runPipeline(checkJSONFile(check, file), checkDef, file));
          }
        }
        break;
      }
      case SourceCodeType.GraphQL: {
        const files = filesOfType(type, visitable);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(runPipeline(checkGraphQLFile(check, file), checkDef, file));
          }
        }
        break;
      }
      case SourceCodeType.LiquidHtml: {
        const files = filesOfType(type, visitable);
        const checkDefs = [DisabledChecksVisitor, ...checksOfType(type, config.checks)];
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(runPipeline(checkLiquidFile(check, file), checkDef, file));
          }
        }
        break;
      }
      case SourceCodeType.YAML: {
        const files = filesOfType(type, visitable);
        const checkDefs = checksOfType(type, config.checks);
        for (const file of files) {
          for (const checkDef of checkDefs) {
            if (isIgnored(file.uri, config, checkDef)) continue;
            const check = createCheck(checkDef, file, config, offenses, dependencies, validateJSON);
            pipelines.push(runPipeline(checkYAMLFile(check, file), checkDef, file));
          }
        }
        break;
      }
    }
  }

  await Promise.all(pipelines);

  return offenses.filter((offense) => !isDisabled(offense));
}

/**
 * A check's own failure, as an offense.
 *
 * Reported under {@link CHECK_ERROR_CODE} rather than the failing check's code: the
 * check found nothing here, it BROKE here, and a consumer counting that check's
 * offenses must not be handed one it did not produce. The message names it so the
 * partial result is attributable.
 *
 * Positioned at the start of the file without reading its source — an unreadable file
 * is one of the ways a pipeline fails, and `file.source` throws for exactly those.
 */
function internalErrorOffense(
  checkDef: CheckDefinition<SourceCodeType>,
  file: SourceCode<SourceCodeType>,
  error: unknown,
): Offense {
  const position = { index: 0, line: 0, character: 0 };
  return {
    type: checkDef.meta.type,
    check: CHECK_ERROR_CODE,
    message: `${checkDef.meta.code} failed on this file and did not finish checking it: ${
      error instanceof Error ? error.message : String(error)
    }`,
    uri: file.uri,
    severity: Severity.ERROR,
    start: position,
    end: position,
  } as Offense;
}

/** One validator per run, created when the first `context.validateJSON` call arrives. */
function makeLazyValidateJSON(
  jsonValidationSet: Dependencies['jsonValidationSet'],
  config: Config,
): ValidateJSON | undefined {
  if (!jsonValidationSet) return undefined;
  let validator: Promise<JSONValidator | undefined> | undefined;
  return async (uri, jsonString) => {
    validator ??= JSONValidator.create(jsonValidationSet, config);
    return (await validator)!.validate(uri, jsonString);
  };
}

function createContext<T extends SourceCodeType, S extends Schema>(
  check: CheckDefinition<T, S>,
  file: SourceCode<T>,
  offenses: Offense[],
  config: Config,
  dependencies: AugmentedDependencies,
  validateJSON?: ValidateJSON,
): Context<T, S> {
  const checkSettings = config.settings[check.meta.code];
  return {
    ...dependencies,
    validateJSON,
    settings: createSettings(checkSettings, check.meta.schema),
    toUri: (relativePath) => path.join(config.rootUri, ...relativePath.split('/')),
    toRelativePath: (uri) => path.relative(uri, config.rootUri),
    // Anchored at the run's root, so a check cannot reach the unanchored answer.
    // Files that ARE in the app carry their type already — this reaches for it on
    // `AppFile` and only re-derives for a URI the app does not contain (a render
    // target that does not exist, a buffer overlaid from outside).
    fileType: (uri = file.uri) =>
      dependencies.app.get(uri)?.fileType ?? commonGetFileType(uri, config.rootUri),
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
  dependencies: AugmentedDependencies,
  validateJSON?: ValidateJSON,
): Check<S> {
  const context = createContext(check, file, offenses, config, dependencies, validateJSON);
  return check.create(context as any) as Check<S>;
}

/**
 * The files a run should visit. Unknown URIs in `only` simply match nothing.
 *
 * Carries no claim about ASTs — it only feeds `load()` and {@link filesOfType},
 * which is where a file's `type` is compared and its AST type therefore known.
 */
function filesToVisit(app: AppModel, only?: UriString[]): SourceAppFile[] {
  const files = app.sourceCodes();
  if (only === undefined) return files;

  const visit = new Set(only);
  return files.filter((file) => visit.has(file.uri));
}

function filesOfType<S extends SourceCodeType>(
  type: S,
  sourceCodes: SourceAppFile[],
): TypedAppFile<S>[] {
  return sourceCodes.filter((file): file is TypedAppFile<S> => file.type === type);
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
