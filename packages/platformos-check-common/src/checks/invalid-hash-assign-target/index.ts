import {
  LiquidTag,
  LiquidHtmlNode,
  LiquidVariable,
  NodeTypes,
  NamedTags,
  HashAssignMarkup,
  GraphQLMarkup,
  GraphQLInlineMarkup,
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

    // Find the applicable type for a variable at a given position
    const findVariableType = (variableName: string, position: number): VariableType | undefined => {
      let result: VariableType | undefined;

      for (const entry of variableTypes) {
        if (entry.name !== variableName) continue;
        const [start, end] = entry.range;
        if (position <= start) continue;
        if (end && position > end) continue;
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
          const markup = node.markup as { name: string };
          if (markup.name) {
            closeTypeRange(markup.name, node.position.start);
            // Function returns are untyped unless we can infer them
            variableTypes.push({
              name: markup.name,
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
