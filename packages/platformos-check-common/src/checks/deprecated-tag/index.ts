import { Severity, SourceCodeType, LiquidCheckDefinition } from '../../types';

export const DeprecatedTag: LiquidCheckDefinition = {
  meta: {
    code: 'DeprecatedTag',
    aliases: ['DeprecatedTags'],
    name: 'Deprecated Tag',
    docs: {
      description: 'This check is aimed at eliminating the use of deprecated tags.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-tag',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    if (!context.platformosDocset) {
      return {};
    }

    return {
      async LiquidTag(node) {
        const tags = await context.platformosDocset!.tags();

        const deprecatedTag = tags.find((t) => t.deprecated && t.name === node.name);

        if (!deprecatedTag) {
          return;
        }

        const source = node.source.substring(node.position.start);
        const tagNameIndex = source.indexOf(node.name);
        const startIndex = node.position.start + tagNameIndex;
        const endIndex = startIndex + node.name.length;

        const message = deprecatedTag.deprecation_reason
          ? `Deprecated tag '${node.name}': ${deprecatedTag.deprecation_reason}`
          : `Deprecated tag '${node.name}'.`;

        context.report({
          message,
          startIndex,
          endIndex,
        });
      },
    };
  },
};
