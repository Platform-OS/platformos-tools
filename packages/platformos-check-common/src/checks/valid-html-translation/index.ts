import { SourceCodeType, YAMLCheckDefinition, Severity, Problem, LiteralNode } from '../../types';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

export const ValidHTMLTranslation: YAMLCheckDefinition = {
  meta: {
    code: 'ValidHTMLTranslation',
    name: 'Valid HTML Translation',
    docs: {
      description: 'This check exists to prevent invalid HTML inside translations.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/valid-html-translation',
      recommended: true,
    },
    type: SourceCodeType.YAML,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    // We ignore yaml files that aren't translation files.
    const relativePath = context.toRelativePath(context.file.uri);
    if (!relativePath.includes('/translations/'))
      return {};

    return {
      async Literal(node: LiteralNode) {
        const htmlRegex = /<[^>]+>/;

        if (typeof node.value !== 'string' || !htmlRegex.test(node.value)) return;

        try {
          toLiquidHtmlAST(node.value);
        } catch (error) {
          const loc = node.loc;

          const problem: Problem<SourceCodeType.YAML> = {
            message: `${error}.`,
            startIndex: loc.start.offset,
            endIndex: loc.end.offset,
          };
          context.report(problem);
        }
      },
    };
  },
};
