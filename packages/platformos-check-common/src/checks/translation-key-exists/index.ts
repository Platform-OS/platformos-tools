import { TranslationProvider } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { URI } from 'vscode-uri';

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
        for (const { translationKey, startIndex, endIndex } of nodes) {
          const translation = await translationProvider.translate(
            URI.parse(context.config.rootUri),
            translationKey,
          );

          if (!!translation) {
            return;
          }

          const message = `'${translationKey}' does not have a matching translation entry`;
          context.report({
            message,
            startIndex,
            endIndex,
          });
        }
      },
    };
  },
};
