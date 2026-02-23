import {
  YAMLCheckDefinition,
  JSONNode,
  YAMLSourceCode,
  Severity,
  SourceCodeType,
  PropertyNode,
} from '../../types';

const PLURALIZATION_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

export const MatchingTranslations: YAMLCheckDefinition = {
  meta: {
    code: 'MatchingTranslations',
    name: 'Translation files should have the same keys',
    docs: {
      description: 'TODO',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/matching-translations',
    },
    type: SourceCodeType.YAML,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    // State
    const defaultTranslations = new Set<string>();
    const missingTranslations = new Set<string>();
    const nodesByPath = new Map<string, PropertyNode>();
    const file = context.file as YAMLSourceCode;
    const fileUri = file.uri;
    const relativePath = context.toRelativePath(fileUri);
    const ast = file.ast;
    const isTranslationFile = relativePath.includes('/translations/');
    // In platformOS, en.yml is the reference locale; skip running the check on it
    const basename = fileUri.split('/').pop() ?? '';
    const isDefaultTranslationsFile = basename.replace(/\.ya?ml$/, '') === 'en';

    if (!isTranslationFile || isDefaultTranslationsFile || ast instanceof Error) {
      // No need to lint a file that isn't a non-default translation file
      return {};
    }

    // Helpers
    const hasDefaultTranslations = () => defaultTranslations.size > 0;
    const isTerminalNode = ({ type }: JSONNode) => type === 'Literal';
    const isPluralizationNode = (node: PropertyNode) => PLURALIZATION_KEYS.has(node.key.value);

    const hasDefaultTranslation = (translationPath: string) =>
      defaultTranslations.has(translationPath) ?? false;

    const isPluralizationPath = (path: string) =>
      [...PLURALIZATION_KEYS].some((key) => path.endsWith(key));

    const jsonPaths = (json: any): string[] => {
      const keys = Object.keys(json);

      return keys.reduce((acc: string[], key: string) => {
        if (typeof json[key] !== 'object') {
          return acc.concat(key);
        }

        const childJson = json[key];
        const childPaths = jsonPaths(childJson);

        return acc.concat(childPaths.map((path) => `${key}.${path}`));
      }, []);
    };

    // Strip the locale prefix (first Property in the ancestors chain).
    // YAML files wrap content under a locale key: { en: { hello: 'Hello' } }
    // We want paths like 'hello', not 'en.hello'.
    const objectPath = (nodes: JSONNode[]) => {
      const props = nodes.filter((n): n is PropertyNode => n.type === 'Property');
      if (props.length <= 1) return ''; // locale key itself, or empty
      return props
        .slice(1)
        .map((p) => p.key.value)
        .join('.');
    };

    const countCommonParts = (arrayA: string[], arrayB: string[]): number => {
      const minLength = Math.min(arrayA.length, arrayB.length);

      for (let i = 0; i < minLength; i++) {
        if (arrayA[i] !== arrayB[i]) {
          return i;
        }
      }

      return minLength;
    };

    const closestTranslationKey = (translationKey: string) => {
      const translationKeyParts = translationKey.split('.');
      let closestMatch = '';
      let maxCommonParts = 0;

      for (const path of nodesByPath.keys()) {
        const pathParts = path.split('.');
        const commonParts = countCommonParts(pathParts, translationKeyParts);

        if (commonParts > maxCommonParts) {
          maxCommonParts = commonParts;
          closestMatch = path;
        }
      }

      return nodesByPath.get(closestMatch) ?? ast;
    };

    return {
      async onCodePathStart() {
        const defaultTranslationPaths = await context.getDefaultTranslations().then(jsonPaths);
        defaultTranslationPaths.forEach(Set.prototype.add, defaultTranslations);

        // At the `onCodePathStart`, we assume that all translations are missing,
        // and remove translation paths while traversing through the file.
        defaultTranslationPaths.forEach(Set.prototype.add, missingTranslations);
      },

      async Property(node, ancestors) {
        const path = objectPath(ancestors.concat(node));

        if (!path) return; // skip the root locale key (e.g. 'pt-BR')

        nodesByPath.set(path, node);

        if (!hasDefaultTranslations()) return;
        if (isPluralizationNode(node)) return;
        if (!isTerminalNode(node.value)) return;

        if (hasDefaultTranslation(path)) {
          // As `path` is present, we remove it from the
          // `missingTranslationsPerFile` bucket.
          missingTranslations.delete(path);
          return;
        }

        context.report({
          message: `A default translation for '${path}' does not exist`,
          startIndex: node.loc!.start.offset,
          endIndex: node.loc!.end.offset,
        });
      },

      async onCodePathEnd() {
        missingTranslations.forEach((path) => {
          const closest = closestTranslationKey(path);

          if (isPluralizationPath(path)) return;

          context.report({
            message: `The translation for '${path}' is missing`,
            startIndex: closest.loc!.start.offset,
            endIndex: closest.loc!.end.offset,
          });
        });
      },
    };
  },
};
