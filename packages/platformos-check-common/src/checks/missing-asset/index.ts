import { DocumentsLocator } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { doesFileExist } from '../../utils/file-utils';
import { isLiquidString } from '../utils';
import { URI } from 'vscode-uri';

export const MissingAsset: LiquidCheckDefinition = {
  meta: {
    code: 'MissingAsset',
    name: 'Avoid rendering missing asset files',
    docs: {
      description: 'Reports missing asset files',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-asset',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const documentsLocator = new DocumentsLocator(context.fs);
    return {
      async LiquidVariable(node) {
        if (node.filters.length === 0 || node.filters[0].name !== 'asset_url') {
          return;
        }

        if (!isLiquidString(node.expression)) return;

        let expression = node.expression;
        const result = await documentsLocator.locate(
          URI.parse(context.config.rootUri),
          'asset',
          expression.value,
        );
        if (!result) {
          context.report({
            message: `'${expression.value}' does not exist`,
            startIndex: expression.position.start,
            endIndex: expression.position.end,
          });
        }
      },
    };
  },
};
