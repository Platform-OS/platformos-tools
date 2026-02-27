import {
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagAssign,
  LiquidTagCapture,
  NodeTypes,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isWithinRawTagThatDoesNotParseItsContents } from '../utils';

export const UnusedAssign: LiquidCheckDefinition = {
  meta: {
    code: 'UnusedAssign',
    name: 'Prevent unused assigns',
    docs: {
      description:
        'This check exists to prevent bloat by surfacing variable definitions that are not used.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unused-assign',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const assignedVariables: Map<string, LiquidTagAssign | LiquidTagCapture> = new Map();
    // Variables assigned from a pure variable lookup (no filters, no literals).
    // e.g. `assign errors = contract.errors` — mutations on `errors` have side
    // effects on the original, so they count as "using" the variable.
    const referenceAssignedVariables: Set<string> = new Set();
    const usedVariables: Set<string> = new Set();

    function checkVariableUsage(node: any) {
      if (node.type === NodeTypes.VariableLookup) {
        usedVariables.add(node.name);
      }
    }

    return {
      async LiquidTag(node, ancestors) {
        if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;
        if (isLiquidTagAssign(node)) {
          if (node.markup.lookups.length === 0 && node.markup.operator === '=') {
            // Simple assignment: register as a new variable
            assignedVariables.set(node.markup.name, node);
            // Track pure reference assignments (VariableLookup with no filters)
            if (
              node.markup.value.type === NodeTypes.LiquidVariable &&
              node.markup.value.expression.type === NodeTypes.VariableLookup &&
              node.markup.value.filters.length === 0
            ) {
              referenceAssignedVariables.add(node.markup.name);
            }
          } else {
            // Hash/array mutation: assign x[key]=val, assign x.key=val, assign x<<val
            // Counts as "using" x only when x is external (not locally assigned here)
            // or was assigned as a reference alias to another variable.
            if (
              !assignedVariables.has(node.markup.name) ||
              referenceAssignedVariables.has(node.markup.name)
            ) {
              usedVariables.add(node.markup.name);
            }
          }
        } else if (isLiquidTagCapture(node) && node.markup.name) {
          assignedVariables.set(node.markup.name, node);
        }
      },

      async VariableLookup(node, ancestors) {
        if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;
        const parentNode = ancestors.at(-1);
        if (parentNode && isLiquidTagCapture(parentNode)) {
          return;
        }
        checkVariableUsage(node);
      },

      async onCodePathEnd() {
        for (const [variable, node] of assignedVariables.entries()) {
          if (!usedVariables.has(variable) && !variable.startsWith('_')) {
            context.report({
              message: `The variable '${variable}' is assigned but not used`,
              startIndex: isLiquidTagCapture(node)
                ? node.blockStartPosition.start
                : node.position.start,
              endIndex: isLiquidTagCapture(node) ? node.blockStartPosition.end : node.position.end,
              suggest: [
                {
                  message: `Remove the unused variable '${variable}'`,
                  fix: (corrector) => corrector.remove(node.position.start, node.position.end),
                },
              ],
            });
          }
        }
      },
    };
  },
};

function isLiquidTagAssign(node: LiquidTag): node is LiquidTagAssign {
  return node.name === 'assign' && typeof node.markup !== 'string';
}

function isLiquidTagCapture(node: LiquidHtmlNode): node is LiquidTagCapture {
  return (
    node.type == NodeTypes.LiquidTag && node.name === 'capture' && typeof node.markup !== 'string'
  );
}
