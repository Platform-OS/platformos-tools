import { isPartial } from '../../to-schema';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

export const OrphanedPartial: LiquidCheckDefinition = {
  meta: {
    code: 'OrphanedPartial',
    name: 'Prevent orphaned partials',
    docs: {
      description: 'This check exists to prevent orphaned partials in themes.',
      recommended: true,
      url: 'https://shopify.dev/docs/storefronts/themes/tools/theme-check/checks/orphaned-partial',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathEnd() {
        const { getReferences } = context;

        if (!getReferences) {
          return;
        }

        const fileUri = context.file.uri;
        if (isPartial(fileUri)) {
          const references = await getReferences(fileUri);

          if (references.length === 0) {
            context.report({
              message: `This partial is not referenced by any other files`,
              startIndex: 0,
              endIndex: 1,
            });
          }
        }
      },
    };
  },
};
