import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import {
  applyFixToString,
  CheckDefinition,
  ChecksSettings,
  Config,
  autofix as coreAutofix,
  check as coreCheck,
  createCorrector,
  Dependencies,
  extractDocDefinition,
  FixApplicator,
  JSONCorrector,
  JSONSourceCode,
  LiquidSourceCode,
  Offense,
  recommended,
  SourceCodeType,
  StringCorrector,
  App,
  toSourceCode,
  YAMLSourceCode,
} from '../index';
import * as path from '../path';
import { MockFileSystem } from './MockFileSystem';
import { MockApp } from './MockApp';

export { JSONCorrector, StringCorrector };

const rootUri = path.normalize('file:/');

export function getApp(themeDesc: MockApp): App {
  return Object.entries(themeDesc)
    .map(([relativePath, source]) => toSourceCode(toUri(relativePath), source))
    .filter((x): x is LiquidSourceCode | JSONSourceCode | YAMLSourceCode => x !== undefined);
}

export async function check(
  themeDesc: MockApp,
  checks: CheckDefinition[] = recommended,
  mockDependencies: Partial<Dependencies> = {},
  checkSettings: ChecksSettings = {},
): Promise<Offense[]> {
  const theme = getApp(themeDesc);
  const config: Config = {
    settings: { ...checkSettings },
    checks,
    rootUri,
    onError: (err) => {
      throw err;
    },
  };

  const defaultMockDependencies: Dependencies = {
    fs: new MockFileSystem({ '.platformos-check.yml': '', ...themeDesc }),
    async getDocDefinition(relativePath) {
      const file = theme.find((file) => file.uri.endsWith(relativePath));
      if (!file || !isLiquidHtmlNode(file.ast)) {
        return undefined;
      }
      return extractDocDefinition(file.uri, file.ast);
    },
    platformosDocset: {
      async graphQL() {
        return null;
      },
      async filters() {
        return [
          { name: 'item_count_for_variant' },
          { name: 'append' },
          { name: 'upcase' },
          { name: 'downcase' },
          { name: 'parameterize' },
          { name: 'slugify' },
        ];
      },
      async objects() {
        return [
          {
            name: 'collections',
          },
          {
            name: 'product',
            access: {
              global: false,
              parents: [],
              template: ['product'],
            },
          },
          {
            name: 'image',
            access: {
              global: false,
              parents: [],
              template: [],
            },
          },
          {
            name: 'context',
            access: {
              global: true,
              parents: [],
              template: [],
            },
          },
          {
            name: 'app',
            access: {
              global: false,
              parents: [],
              template: [],
            },
          },
        ];
      },
      async liquidDrops() {
        return this.objects();
      },
      async tags() {
        return [];
      },
      async systemTranslations() {
        return { 'shopify.sentence.words_connector': ', ' };
      },
    },
  };

  return coreCheck(theme, config, { ...defaultMockDependencies, ...mockDependencies });
}

export async function runLiquidCheck(
  checkDef: CheckDefinition<SourceCodeType.LiquidHtml>,
  sourceCode: string,
  fileName: string = 'file.liquid',
  mockDependencies: Partial<Dependencies> = {},
  existingThemeFiles?: MockApp,
): Promise<Offense[]> {
  const offenses = await check(
    { ...existingThemeFiles, [fileName]: sourceCode },
    [checkDef],
    mockDependencies,
  );
  return offenses.filter((offense) => offense.uri === path.join(rootUri, fileName));
}

export async function runJSONCheck(
  checkDef: CheckDefinition<SourceCodeType.JSON>,
  sourceCode: string,
  fileName: string = 'file.json',
  mockDependencies: Partial<Dependencies> = {},
): Promise<Offense[]> {
  const offenses = await check({ [fileName]: sourceCode }, [checkDef], mockDependencies);
  return offenses.filter((offense) => offense.uri === path.join(rootUri, fileName));
}

export async function runYAMLCheck(
  checkDef: CheckDefinition<SourceCodeType.YAML>,
  sourceCode: string,
  fileName: string = 'file.yml',
  mockDependencies: Partial<Dependencies> = {},
): Promise<Offense[]> {
  const offenses = await check({ [fileName]: sourceCode }, [checkDef], mockDependencies);
  return offenses.filter((offense) => offense.uri === path.join(rootUri, fileName));
}

export async function autofix(themeDesc: MockApp, offenses: Offense[]) {
  const theme = getApp(themeDesc);
  const fixed = { ...themeDesc };

  const stringApplicator: FixApplicator = async (sourceCode, fixes) => {
    fixed[asRelative(sourceCode.uri)] = applyFixToString(sourceCode.source, fixes);
  };

  await coreAutofix(theme, offenses, stringApplicator);

  return fixed;
}

export function applyFix(
  themeDescOrSource: MockApp | string,
  offense: Offense,
): string | undefined {
  const source =
    typeof themeDescOrSource === 'string'
      ? themeDescOrSource
      : themeDescOrSource[asRelative(offense.uri)];
  const corrector = createCorrector(offense.type, source);
  offense.fix?.(corrector as any);
  return applyFixToString(source, corrector.fix);
}

export function applySuggestions(
  themeDescOrSource: MockApp | string,
  offense: Offense,
): undefined | string[] {
  const source =
    typeof themeDescOrSource === 'string'
      ? themeDescOrSource
      : themeDescOrSource[asRelative(offense.uri)];
  return offense.suggest?.map((suggestion) => {
    const corrector = createCorrector(offense.type, source);
    suggestion.fix(corrector as any);
    return applyFixToString(source, corrector.fix);
  });
}

export function highlightedOffenses(themeOrSource: MockApp | string, offenses: Offense[]) {
  const theme =
    typeof themeOrSource === 'string' ? { 'file.liquid': themeOrSource } : themeOrSource;
  return offenses.map((offense) => {
    const relativePath = path.relative(offense.uri, rootUri);
    const source = theme[relativePath];
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
