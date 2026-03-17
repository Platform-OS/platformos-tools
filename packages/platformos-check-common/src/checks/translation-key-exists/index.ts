import { TranslationProvider } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { URI, Utils } from 'vscode-uri';
import { flattenTranslationKeys, findNearestKeys } from '../../utils/levenshtein';

function keyExists(key: string, pointer: any) {
  for (const token of key.split('.')) {
    if (typeof pointer !== 'object') {
      return false;
    }

    if (!pointer.hasOwnProperty(token)) {
      return false;
    }

    pointer = pointer[token];
  }

  return true;
}

export const TranslationKeyExists: LiquidCheckDefinition = {
  meta: {
    code: 'TranslationKeyExists',
    name: 'Reports missing translation keys',
    docs: {
      description: 'Reports missing translation keys',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/translation-key-exists',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const nodes: { translationKey: string; startIndex: number; endIndex: number }[] = [];
    const translationProvider = new TranslationProvider(context.fs);

    return {
      async LiquidVariable(node) {
        if (node.expression.type !== 'String') {
          return;
        }

        if (!node.filters.some(({ name }) => ['t', 'translate'].includes(name))) {
          return;
        }

        nodes.push({
          translationKey: node.expression.value,
          startIndex: node.expression.position.start,
          endIndex: node.expression.position.end,
        });
      },

      async onCodePathEnd() {
        let allDefinedKeys: string[] | null = null;

        for (const { translationKey, startIndex, endIndex } of nodes) {
          const translation = await translationProvider.translate(
            URI.parse(context.config.rootUri),
            translationKey,
          );

          if (!!translation) {
            continue;
          }

          // Lazy-load all keys once per file
          if (allDefinedKeys === null) {
            const baseUri = Utils.joinPath(URI.parse(context.config.rootUri), 'app/translations');
            try {
              const allTranslations = await translationProvider.loadAllTranslationsForBase(
                baseUri,
                'en',
              );
              allDefinedKeys = flattenTranslationKeys(allTranslations);
            } catch {
              allDefinedKeys = [];
            }
          }

          const nearest = findNearestKeys(translationKey, allDefinedKeys);
          const message = `'${translationKey}' does not have a matching translation entry`;

          context.report({
            message,
            startIndex,
            endIndex,
            suggest:
              nearest.length > 0
                ? nearest.map((key) => ({
                    message: `Did you mean '${key}'?`,
                    fix: (fixer: any) => fixer.replace(startIndex, endIndex, `'${key}'`),
                  }))
                : undefined,
          });
        }
      },
    };
  },
};
