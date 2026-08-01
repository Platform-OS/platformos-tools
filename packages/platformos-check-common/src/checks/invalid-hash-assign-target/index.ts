import {
  LiquidTag,
  LiquidHtmlNode,
  LiquidVariable,
  NodeTypes,
  NamedTags,
  HashAssignMarkup,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  FunctionMarkup,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isError } from '../../utils';

type VariableType = 'number' | 'string' | 'boolean' | 'object' | 'array' | 'untyped';

interface VariableTypeEntry {
  name: string;
  type: VariableType;
  range: [start: number, end?: number];
}

export const InvalidHashAssignTarget: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidHashAssignTarget',
    name: 'Invalid hash_assign target',
    docs: {
      description:
        'Reports errors when hash_assign is used on a variable that is not an object type (e.g., number, string, boolean, array).',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const ast = context.file.ast;
    if (isError(ast)) return {};

    // Track variable types
    const variableTypes: VariableTypeEntry[] = [];

    // Helper to close previous type ranges when a variable is reassigned
    const closeTypeRange = (variableName: string, endPosition: number) => {
      for (let i = variableTypes.length - 1; i >= 0; i--) {
        if (variableTypes[i].name === variableName && variableTypes[i].range[1] === undefined) {
          variableTypes[i].range[1] = endPosition;
          break;
        }
      }
    };

    /**
     * The type in effect for `variableName` at `position`, or `undefined` if none is
     * known there.
     *
     * THE START BOUND IS INCLUSIVE, and that is the whole fix. A range STARTS at the
     * defining tag's `position.end`, which is an offset a real tag can begin at
     * exactly, because Liquid tags may abut with nothing between them:
     *
     *   {% assign x = 5 %}{% hash_assign x['k'] = 'v' %}
     *                     ^ range start AND lookup position are both 18
     *
     * An exclusive `position <= start` excluded that case, so the check went silent
     * on a buffer the runtime raises `HashAssignTagError` for, while firing on the
     * same code with a single space inserted. The defect therefore looked like the
     * check being dead rather than a boundary being wrong, and an evaluation reported
     * it as such. A node that begins exactly where the previous one ended IS after
     * it, and no two nodes share an offset, so nothing is admitted wrongly.
     *
     * THE END BOUND IS NOT SYMMETRIC WITH IT, despite reading that way. A range is
     * closed at the START offset of the tag that redefines the variable, and that
     * tag's own lookup — if it performs one — happens BEFORE the close, while the
     * range is still open. Every later lookup sits at a strictly greater offset. So
     * no lookup can land on a closed range's end, and `>` versus `>=` is not
     * currently distinguishable by any buffer: verified by flipping it, which changes
     * no test. It is written as the inclusive reading because that is what the range
     * means; do not infer from the symmetry that both bounds were measured.
     *
     * Later entries win, which is what resolves a reassignment whose ranges abut.
     */
    const findVariableType = (variableName: string, position: number): VariableType | undefined => {
      let result: VariableType | undefined;

      for (const entry of variableTypes) {
        if (entry.name !== variableName) continue;
        const [start, end] = entry.range;
        if (position < start) continue;
        // `end !== undefined`, not `end`: "no upper bound" is an OPEN range, which is
        // exactly `undefined` — truthiness would also reopen a range closed at offset
        // 0. Defensive rather than a live fix: an entry's start is a preceding tag's
        // end, so a close at 0 cannot occur. Written this way because the predicate
        // should be right by construction, not by an argument about offsets.
        if (end !== undefined && position > end) continue;
        result = entry.type;
      }

      return result;
    };

    // Infer the type from a LiquidVariable (expression + filters)
    const inferVariableType = (variable: LiquidVariable): VariableType => {
      // Check filters that change the type
      if (variable.filters && variable.filters.length > 0) {
        const lastFilter = variable.filters[variable.filters.length - 1];

        // Filters that return objects
        if (lastFilter.name === 'parse_json' || lastFilter.name === 'to_hash') {
          return 'object';
        }

        // Filters that return numbers
        if (
          lastFilter.name === 'size' ||
          lastFilter.name === 'abs' ||
          lastFilter.name === 'ceil' ||
          lastFilter.name === 'floor' ||
          lastFilter.name === 'round' ||
          lastFilter.name === 'plus' ||
          lastFilter.name === 'minus' ||
          lastFilter.name === 'times' ||
          lastFilter.name === 'divided_by' ||
          lastFilter.name === 'modulo'
        ) {
          return 'number';
        }

        // Filters that return strings
        if (
          lastFilter.name === 'append' ||
          lastFilter.name === 'prepend' ||
          lastFilter.name === 'capitalize' ||
          lastFilter.name === 'downcase' ||
          lastFilter.name === 'upcase' ||
          lastFilter.name === 'strip' ||
          lastFilter.name === 'strip_html' ||
          lastFilter.name === 'strip_newlines' ||
          lastFilter.name === 'truncate' ||
          lastFilter.name === 'truncatewords' ||
          lastFilter.name === 'replace' ||
          lastFilter.name === 'replace_first' ||
          lastFilter.name === 'remove' ||
          lastFilter.name === 'remove_first' ||
          lastFilter.name === 'slice' ||
          lastFilter.name === 'split' ||
          lastFilter.name === 'join' ||
          lastFilter.name === 'json'
        ) {
          return 'string';
        }

        // Filters that return arrays
        if (
          lastFilter.name === 'split' ||
          lastFilter.name === 'sort' ||
          lastFilter.name === 'sort_natural' ||
          lastFilter.name === 'reverse' ||
          lastFilter.name === 'uniq' ||
          lastFilter.name === 'compact' ||
          lastFilter.name === 'concat' ||
          lastFilter.name === 'map' ||
          lastFilter.name === 'where'
        ) {
          return 'array';
        }
      }

      // Fall back to expression type
      const expr = variable.expression;
      switch (expr.type) {
        case NodeTypes.Number:
          return 'number';
        case NodeTypes.String:
          return 'string';
        case NodeTypes.LiquidLiteral:
          // true, false, nil, blank, empty
          if (expr.keyword === 'true' || expr.keyword === 'false') {
            return 'boolean';
          }
          return 'untyped';
        case NodeTypes.Range:
          return 'array';
        case NodeTypes.BooleanExpression:
          return 'boolean';
        default:
          return 'untyped';
      }
    };

    return {
      async LiquidTag(node: LiquidTag) {
        // {% assign x = value %}
        if (isLiquidTagAssign(node)) {
          const markup = node.markup;

          // Close any previous type for this variable (reassignment)
          closeTypeRange(markup.name, node.position.start);

          const inferredType = inferVariableType(markup.value);
          variableTypes.push({
            name: markup.name,
            type: inferredType,
            range: [node.position.end],
          });
        }

        // {% increment x %} / {% decrement x %}
        if (
          (node.name === NamedTags.increment || node.name === NamedTags.decrement) &&
          typeof node.markup !== 'string' &&
          node.markup.name
        ) {
          closeTypeRange(node.markup.name, node.position.start);
          variableTypes.push({
            name: node.markup.name,
            type: 'number',
            range: [node.position.end],
          });
        }

        // {% capture x %}...{% endcapture %}
        if (node.name === NamedTags.capture && typeof node.markup !== 'string') {
          const variableName = (node.markup as { name?: string }).name;
          if (variableName) {
            closeTypeRange(variableName, node.position.start);
            variableTypes.push({
              name: variableName,
              type: 'string',
              range: [node.blockEndPosition?.end ?? node.position.end],
            });
          }
        }

        // {% parse_json x %}...{% endparse_json %}
        if (isLiquidTagParseJson(node)) {
          const variableName = node.markup.name;
          if (variableName) {
            closeTypeRange(variableName, node.position.start);
            variableTypes.push({
              name: variableName,
              type: 'object',
              range: [node.blockEndPosition?.end ?? node.position.end],
            });
          }
        }

        // {% graphql result %}...{% endgraphql %} or {% graphql result = 'file' %}
        if (isLiquidTagGraphQL(node)) {
          const markup = node.markup;
          const variableName = markup.name;
          if (variableName) {
            closeTypeRange(variableName, node.position.start);
            variableTypes.push({
              name: variableName,
              type: 'object',
              range: [node.blockEndPosition?.end ?? node.position.end],
            });
          }
        }

        // {% function result = 'path' %}
        if (node.name === NamedTags.function && typeof node.markup !== 'string') {
          const markup = node.markup as FunctionMarkup;
          const varName = markup.name.name;
          if (varName) {
            closeTypeRange(varName, node.position.start);
            // Function returns are untyped unless we can infer them
            variableTypes.push({
              name: varName,
              type: 'untyped',
              range: [node.position.end],
            });
          }
        }

        // {% hash_assign x['key'] = value %} - validate the target
        if (isLiquidTagHashAssign(node)) {
          const markup = node.markup;
          const variableName = markup.target.name;

          if (variableName) {
            const existingType = findVariableType(variableName, node.position.start);

            // Report error if target is a primitive type
            if (
              existingType === 'number' ||
              existingType === 'string' ||
              existingType === 'boolean'
            ) {
              context.report({
                message: `Cannot use hash_assign on '${variableName}' which is a ${existingType}. hash_assign can only be used on object types.`,
                startIndex: markup.target.position.start,
                endIndex: markup.target.position.end,
              });
            } else if (existingType === 'array') {
              context.report({
                message: `Cannot use hash_assign on '${variableName}' which is an array. hash_assign can only be used on object types.`,
                startIndex: markup.target.position.start,
                endIndex: markup.target.position.end,
              });
            }

            // Track the new type (hash_assign makes it an object)
            closeTypeRange(variableName, node.position.start);
            variableTypes.push({
              name: variableName,
              type: 'object',
              range: [node.position.end],
            });
          }
        }
      },
    };
  },
};

// Type guards
function isLiquidTagAssign(
  node: LiquidTag,
): node is LiquidTag & { markup: { name: string; value: LiquidVariable } } {
  return node.name === NamedTags.assign && typeof node.markup !== 'string';
}

function isLiquidTagParseJson(
  node: LiquidTag,
): node is LiquidTag & { markup: { name: string }; children: LiquidHtmlNode[] } {
  return node.name === NamedTags.parse_json && typeof node.markup !== 'string';
}

function isLiquidTagGraphQL(
  node: LiquidTag,
): node is LiquidTag & { markup: GraphQLMarkup | GraphQLInlineMarkup } {
  return node.name === NamedTags.graphql && typeof node.markup !== 'string';
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}
