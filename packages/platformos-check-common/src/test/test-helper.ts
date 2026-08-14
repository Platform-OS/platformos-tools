import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import { AbstractFileSystem, App as AppModel } from '@platformos/platformos-common';
import {
  applyFixToString,
  CheckDefinition,
  CheckOptions,
  ChecksSettings,
  Config,
  autofix as coreAutofix,
  check as coreCheck,
  createCorrector,
  Dependencies,
  extractDocDefinition,
  FixApplicator,
  Offense,
  PlatformOSDocset,
  recommended,
  sourceParsers,
  SourceCodeType,
  StringCorrector,
} from '../index';
import * as path from '../path';
import { MockFileSystem } from './MockFileSystem';
import { publishedDocset } from './published-docset';
import { MockApp } from './MockApp';

export { StringCorrector };

/** The project root every fixture path in this file is relative to. */
export const mockRootUri = path.normalize('file:/');

const rootUri = mockRootUri;

/**
 * The fixture as the {@link AppModel}, so a check under test resolves names through
 * the same index, the same `searchPathIndex` precedence and the same module
 * shadowing that ship.
 *
 * A path the model does not classify is an authoring error, not a silent no-op. The
 * model only holds files in a recognized platformOS directory, so `file.liquid` at
 * the root is dropped, the app comes out empty, and the test passes for the wrong
 * reason — which is what two fixtures here were already doing. Hence the throw.
 *
 * `has()`, not `sourceCodes()`: `app/assets/styles.css` is legitimately in the app
 * with no `SourceCodeType`, and `MissingAsset`'s fixtures need it there.
 */
export function getApp(appDesc: MockApp, fs: AbstractFileSystem = new MockFileSystem(appDesc)) {
  const app = AppModel.fromSources(rootUri, appDesc, fs, sourceParsers);

  const dropped = Object.keys(appDesc).filter((relativePath) => !app.has(toUri(relativePath)));
  if (dropped.length > 0) {
    throw new Error(
      `Fixture paths are not in any platformOS directory, so the app does not contain ` +
        `them and nothing would be checked: ${dropped.join(', ')}`,
    );
  }

  return app;
}

export async function check(
  appDesc: MockApp,
  checks: CheckDefinition[] = recommended,
  mockDependencies: Partial<Dependencies> = {},
  checkSettings: ChecksSettings = {},
  options: CheckOptions = {},
): Promise<Offense[]> {
  // One filesystem behind both the app and the dependencies, so a file the checks
  // read through `fs` and the same file read through the model cannot differ.
  const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appDesc });
  const app = getApp(appDesc, fs);
  const checkOptions: CheckOptions = { ...options };
  const config: Config = {
    settings: { ...checkSettings },
    checks,
    rootUri,
    onError: (err) => {
      throw err;
    },
  };

  return coreCheck(
    app,
    config,
    { ...createMockDependencies(fs, app), ...mockDependencies },
    checkOptions,
  );
}

/**
 * The injected services a check run gets in tests: a mock filesystem and a small,
 * REAL-shaped docset.
 *
 * Exported because {@link check} builds a fresh app per call, which is the wrong tool
 * for a test about what survives BETWEEN runs — a parse the app is supposed to keep.
 * Such a test builds its own app once and calls the engine directly, and this is how it
 * gets the same docset every other test measures against.
 */
export function createMockDependencies(
  fs: AbstractFileSystem,
  app: AppModel,
): Dependencies & { platformosDocset: PlatformOSDocset } {
  return {
    fs,
    async getDocDefinition(relativePath) {
      const file = app.get(toUri(relativePath));
      if (!file || !isLiquidHtmlNode(file.ast)) {
        return undefined;
      }
      return extractDocDefinition(file.uri, file.ast);
    },
    platformosDocset: publishedDocset,
  };
}

/**
 * The default fixture paths below are real platformOS paths, because the fixture is
 * a real {@link AppModel} now: a file at the project root is in no app and would be
 * checked by nothing. A test whose subject depends on the file's TYPE — a layout, a
 * page, a translation — should name its own path rather than lean on these.
 */
export async function runLiquidCheck(
  checkDef: CheckDefinition<SourceCodeType.LiquidHtml>,
  sourceCode: string,
  fileName: string = 'app/views/partials/file.liquid',
  mockDependencies: Partial<Dependencies> = {},
  existingAppFiles?: MockApp,
): Promise<Offense[]> {
  const offenses = await check(
    { ...existingAppFiles, [fileName]: sourceCode },
    [checkDef],
    mockDependencies,
  );
  return offenses.filter((offense) => offense.uri === path.join(rootUri, fileName));
}

/** Just the messages of a run's offenses, for the whole-array equality a suite asserts. */
export function messagesOf(offenses: readonly { message: string }[]): string[] {
  return offenses.map((offense) => offense.message);
}

export async function runYAMLCheck(
  checkDef: CheckDefinition<SourceCodeType.YAML>,
  sourceCode: string,
  fileName: string = 'app/translations/en.yml',
  mockDependencies: Partial<Dependencies> = {},
): Promise<Offense[]> {
  const offenses = await check({ [fileName]: sourceCode }, [checkDef], mockDependencies);
  return offenses.filter((offense) => offense.uri === path.join(rootUri, fileName));
}

export async function autofix(appDesc: MockApp, offenses: Offense[]) {
  const app = getApp(appDesc);
  const fixed = { ...appDesc };

  const stringApplicator: FixApplicator = async (sourceCode, fixes) => {
    fixed[asRelative(sourceCode.uri)] = applyFixToString(sourceCode.source, fixes);
  };

  await coreAutofix(app, offenses, stringApplicator);

  return fixed;
}

export function applyFix(appDescOrSource: MockApp | string, offense: Offense): string | undefined {
  const source =
    typeof appDescOrSource === 'string'
      ? appDescOrSource
      : appDescOrSource[asRelative(offense.uri)];
  const corrector = createCorrector(offense.type, source);
  offense.fix?.(corrector as any);
  return applyFixToString(source, corrector.fix);
}

export function applySuggestions(
  appDescOrSource: MockApp | string,
  offense: Offense,
): undefined | string[] {
  const source =
    typeof appDescOrSource === 'string'
      ? appDescOrSource
      : appDescOrSource[asRelative(offense.uri)];
  return offense.suggest?.map((suggestion) => {
    const corrector = createCorrector(offense.type, source);
    suggestion.fix(corrector as any);
    return applyFixToString(source, corrector.fix);
  });
}

export function highlightedOffenses(appOrSource: MockApp | string, offenses: Offense[]) {
  const app =
    typeof appOrSource === 'string'
      ? { 'app/views/partials/file.liquid': appOrSource }
      : appOrSource;
  return offenses.map((offense) => {
    const relativePath = path.relative(offense.uri, rootUri);
    const source = app[relativePath];
    const {
      start: { index: startIndex },
      end: { index: endIndex },
    } = offense;

    return source.slice(startIndex, endIndex);
  });
}

function toUri(relativePath: string) {
  return path.join(rootUri, relativePath);
}

function asRelative(uri: string) {
  return path.relative(path.normalize(uri), rootUri);
}

export function prettyJSON(obj: any): string {
  return JSON.stringify(obj, null, 2);
}
