import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { findNearestKeys } from '../../utils/levenshtein';
import { loadAllDefinedKeys } from '../translation-utils';

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
        if (nodes.length === 0) return;

        // Load all defined keys (app + modules) once per file
        const allDefinedKeys = await loadAllDefinedKeys(context);
        const definedKeySet = new Set(allDefinedKeys);

        for (const { translationKey, startIndex, endIndex } of nodes) {
          if (definedKeySet.has(translationKey)) continue;

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
