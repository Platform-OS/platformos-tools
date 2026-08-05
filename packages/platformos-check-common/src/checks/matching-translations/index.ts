import {
  DEFAULT_LOCALE,
  getTranslationBase,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import {
  YAMLCheckDefinition,
  JSONNode,
  YAMLSourceCode,
  Severity,
  SourceCodeType,
  PropertyNode,
  ObjectNode,
} from '../../types';

const PLURALIZATION_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Returns the locale declared in a YAML translation file by reading its first
 * top-level key (e.g. `en`, `pt-BR`, `fr`).  platformOS determines a file's
 * locale from content, not from its path.
 */
function getLocaleFromAst(ast: JSONNode | Error): string | null {
  if (ast instanceof Error) return null;
  if (ast.type !== 'Object') return null;
  const firstProp = (ast as ObjectNode).children[0];
  if (!firstProp || firstProp.type !== 'Property') return null;
  return firstProp.key.value || null;
}

export const MatchingTranslations: YAMLCheckDefinition = {
  meta: {
    code: 'MatchingTranslations',
    name: 'Translation files should have the same keys',
    docs: {
      description:
        'Every key in the default `en` locale should exist in each other locale, and ' +
        'no locale should define a key `en` does not. A key a locale is missing falls ' +
        'back to the `en` text, so the page renders English at the visitor rather than ' +
        'failing visibly, and a key only one locale defines is dead weight nothing ' +
        'will ever look up.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/matching-translations',
    },
    type: SourceCodeType.YAML,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    // ── State ──────────────────────────────────────────────────────────────
    const enTranslations = new Set<string>(); // keys present in the en scope
    const missingFromLocale = new Set<string>(); // en keys absent from the entire locale scope
    const nodesByPath = new Map<string, PropertyNode>();

    const file = context.file as YAMLSourceCode;
    const fileUri = file.uri;
    const relativePath = context.toRelativePath(fileUri);
    const ast = file.ast;

    // ── Guard: only lint translation files ────────────────────────────────
    const isTranslationFile = context.fileType(fileUri) === PlatformOSFileType.Translation;

    // The locale is always the first top-level key in the YAML file (e.g. `en`,
    // `pt-BR`). platformOS resolves locale from content, not from the file path.
    const locale = getLocaleFromAst(ast);

    if (!isTranslationFile || !locale || locale === DEFAULT_LOCALE || ast instanceof Error) {
      return {};
    }

    // ── Derive scope (translation base URI) ──────────────────────────────
    const relativeBase = getTranslationBase(relativePath);
    if (!relativeBase) return {};

    const translationBaseUri = context.toUri(relativeBase);

    // A "primary" locale file is the top-level `{locale}.yml` (not inside a
    // locale sub-directory like `pt-BR/`).  Only the primary file reports
    // missing translations to avoid duplicate offenses across split files.
    const pathAfterBase = relativePath.substring(relativeBase.length + 1);
    const isPrimaryLocaleFile = !pathAfterBase.includes('/');

    // ── Helpers ───────────────────────────────────────────────────────────
    const isTerminalNode = ({ type }: JSONNode) => type === 'Literal';
    const isPluralizationNode = (node: PropertyNode) => PLURALIZATION_KEYS.has(node.key.value);
    const isPluralizationPath = (path: string) =>
      [...PLURALIZATION_KEYS].some((key) => path.endsWith(key));

    const countCommonParts = (a: string[], b: string[]): number => {
      const min = Math.min(a.length, b.length);
      for (let i = 0; i < min; i++) if (a[i] !== b[i]) return i;
      return min;
    };

    const closestTranslationKey = (key: string) => {
      const keyParts = key.split('.');
      let closest = '';
      let max = 0;
      for (const path of nodesByPath.keys()) {
        const common = countCommonParts(path.split('.'), keyParts);
        if (common > max) {
          max = common;
          closest = path;
        }
      }
      return nodesByPath.get(closest) ?? ast;
    };

    // Strip the locale prefix (first Property in the ancestors chain).
    // YAML files wrap content under a locale key: { en: { hello: 'Hello' } }
    // We want paths like 'hello', not 'en.hello'.
    const objectPath = (nodes: JSONNode[]) => {
      const props = nodes.filter((n): n is PropertyNode => n.type === 'Property');
      if (props.length <= 1) return '';
      return props
        .slice(1)
        .map((p) => p.key.value)
        .join('.');
    };

    /**
     * Every key path in a locale's aggregated translations. A nested MAP contributes its
     * children; anything else is a leaf, which takes two cases with it:
     *
     * - a key written with no value (`moto:` on its own line, which is what a translator
     *   leaves behind) holds nil, and `typeof null` is `'object'` — recursing into it
     *   called `Object.keys(null)` and threw, costing every OTHER file in the same locale
     *   scope its offenses;
     * - a LIST is one key, because `t` returns the whole list. Descending into it asked
     *   each locale for `types.0`, `types.1`, … which no author can add and a translated
     *   list of a different length does not have. `flattenTranslationKeys` counts a list
     *   the same way, so the two checks agree about what a key is.
     */
    const jsonPaths = (json: any): string[] =>
      Object.keys(json).reduce((acc: string[], key: string) => {
        const value = json[key];
        const isMap = value !== null && typeof value === 'object' && !Array.isArray(value);
        return isMap ? acc.concat(jsonPaths(value).map((p) => `${key}.${p}`)) : acc.concat(key);
      }, []);

    return {
      async onCodePathStart() {
        // Aggregate ALL en translations in this scope (en.yml + en/*.yml)
        const en = await context.getTranslationsForBase(translationBaseUri, DEFAULT_LOCALE);
        jsonPaths(en).forEach(Set.prototype.add, enTranslations);

        if (!isPrimaryLocaleFile) return;

        // For the primary locale file: pre-compute which en keys are absent
        // from the entire locale scope (locale.yml + locale/*.yml).
        const localeAgg = await context.getTranslationsForBase(translationBaseUri, locale);
        const localeKeys = new Set(jsonPaths(localeAgg));
        for (const key of enTranslations) {
          if (!localeKeys.has(key)) missingFromLocale.add(key);
        }
      },

      async Property(node, ancestors) {
        const path = objectPath(ancestors.concat(node));
        if (!path) return;

        nodesByPath.set(path, node);

        if (isPluralizationNode(node)) return;
        if (!isTerminalNode(node.value)) return;
        if (!enTranslations.size) return; // no en reference — skip

        if (!enTranslations.has(path)) {
          context.report({
            message: `A translation for '${path}' does not exist in the en locale`,
            startIndex: node.loc!.start.offset,
            endIndex: node.loc!.end.offset,
          });
        }
      },

      async onCodePathEnd() {
        if (!isPrimaryLocaleFile) return;

        for (const key of missingFromLocale) {
          if (isPluralizationPath(key)) continue;
          const closest = closestTranslationKey(key);
          context.report({
            message: `The translation for '${key}' is missing`,
            startIndex: closest.loc!.start.offset,
            endIndex: closest.loc!.end.offset,
          });
        }
      },
    };
  },
};
