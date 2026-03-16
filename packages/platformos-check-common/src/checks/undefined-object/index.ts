import {
  LiquidDocParamNode,
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagAssign,
  LiquidTagCapture,
  LiquidTagDecrement,
  LiquidTagFor,
  LiquidTagIncrement,
  LiquidTagTablerow,
  LiquidVariableLookup,
  LiquidTagFunction,
  NamedTags,
  NodeTypes,
  Position,
  FunctionMarkup,
  LiquidTagHashAssign,
  LiquidTagGraphQL,
  LiquidTagParseJson,
  LiquidTagBackground,
  BackgroundMarkup,
  YAMLFrontmatter,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType, PlatformOSDocset } from '../../types';
import { isError, last } from '../../utils';
import { isWithinRawTagThatDoesNotParseItsContents } from '../utils';
import yaml from 'js-yaml';

type Scope = { start?: number; end?: number };

export const UndefinedObject: LiquidCheckDefinition = {
  meta: {
    code: 'UndefinedObject',
    name: 'Undefined Object',
    docs: {
      description: 'This check exists to identify references to undefined Liquid objects.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/undefined-object',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const relativePath = context.toRelativePath(context.file.uri);
    const ast = context.file.ast;

    if (isError(ast)) return {};

    /**
     * Skip this check when definitions for global objects are unavailable.
     */
    if (!context.platformosDocset) {
      return {};
    }

    const platformosDocset = context.platformosDocset;
    const scopedVariables: Map<string, Scope[]> = new Map();
    const fileScopedVariables: Set<string> = new Set();
    const variables: LiquidVariableLookup[] = [];

    function indexVariableScope(variableName: string | null, scope: Scope) {
      if (!variableName) return;

      const indexedScope = scopedVariables.get(variableName) ?? [];
      scopedVariables.set(variableName, indexedScope.concat(scope));
    }

    return {
      async LiquidDocParamNode(node: LiquidDocParamNode) {
        const paramName = node.paramName?.value;
        if (paramName) {
          fileScopedVariables.add(paramName);
        }
      },

      async YAMLFrontmatter(node: YAMLFrontmatter) {
        try {
          const parsed = yaml.load(node.body) as any;
          if (parsed?.metadata?.params && typeof parsed.metadata.params === 'object') {
            fileScopedVariables.add('params');
          }
        } catch {
          // Invalid YAML frontmatter — skip
        }
      },

      async LiquidTag(node, ancestors) {
        if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

        if (isLiquidTagAssign(node) || isLiquidTagGraphQL(node) || isLiquidTagParseJson(node)) {
          indexVariableScope(node.markup.name, {
            start: node.blockStartPosition.end,
          });
        }

        if (isLiquidTagHashAssign(node) && node.markup.target.name) {
          indexVariableScope(node.markup.target.name, {
            start: node.blockStartPosition.end,
          });
        }

        if (isLiquidTagCapture(node)) {
          indexVariableScope(node.markup.name, {
            start: node.blockEndPosition?.end,
          });
        }

        /**
         * {% form 'cart', cart %}
         *   {{ form }}
         * {% endform %}
         */
        if (node.name === 'form') {
          indexVariableScope(node.name, {
            start: node.blockStartPosition.end,
            end: node.blockEndPosition?.start,
          });
        }

        if (node.name === 'function') {
          const fnName = (node.markup as FunctionMarkup).name;
          // Only register simple variable names (not hash/array mutations like hash['key'])
          if (fnName.lookups.length === 0 && fnName.name !== null) {
            indexVariableScope(fnName.name, {
              start: node.position.end,
            });
          }
        }

        if (node.name === 'layout') {
          indexVariableScope('none', {
            start: node.position.start,
            end: node.position.end,
          });
        }

        /* {% increment var %} */
        if (
          (isLiquidTagIncrement(node) || isLiquidTagDecrement(node)) &&
          node.markup.name !== null
        ) {
          indexVariableScope(node.markup.name, {
            start: node.position.start,
          });
        }

        /**
         * {% for x in y %}
         *   {{ forloop }}
         *   {{ x }}
         * {% endfor %}
         */
        if (isLiquidForTag(node) || isLiquidTableRowTag(node)) {
          indexVariableScope(node.markup.variableName, {
            start: node.blockStartPosition.end,
            end: node.blockEndPosition?.start,
          });
          indexVariableScope(node.name === 'for' ? 'forloop' : 'tablerowloop', {
            start: node.blockStartPosition.end,
            end: node.blockEndPosition?.start,
          });
        }

        if (isLiquidTagBackground(node)) {
          indexVariableScope(node.markup.jobId, {
            start: node.position.end,
          });
        }
      },

      async VariableLookup(node, ancestors) {
        if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

        const parent = last(ancestors);
        if (isLiquidTag(parent) && isLiquidTagCapture(parent)) return;
        if (isLiquidTag(parent) && isLiquidTagParseJson(parent)) return;
        // Skip the result variable of function tags (it's a definition, not a usage)
        if (isFunctionMarkup(parent) && parent.name === node) return;

        variables.push(node);
      },

      async onCodePathEnd() {
        const objects = await globalObjects(platformosDocset, relativePath);

        objects.forEach((obj) => fileScopedVariables.add(obj.name));

        variables.forEach((variable) => {
          if (!variable.name) return;

          const isVariableDefined = isDefined(
            variable.name,
            variable.position,
            fileScopedVariables,
            scopedVariables,
          );
          if (isVariableDefined) return;

          context.report({
            message: `Unknown object '${variable.name}' used.`,
            startIndex: variable.position.start,
            endIndex: variable.position.end,
          });
        });
      },
    };
  },
};

async function globalObjects(platformosDocset: PlatformOSDocset, relativePath: string) {
  const objects = await platformosDocset.objects();
  const contextualObjects = getContextualObjects(relativePath);

  const globalObjects = objects.filter(({ access, name }) => {
    return (
      contextualObjects.includes(name) ||
      !access ||
      access.global === true ||
      access.template.length > 0
    );
  });

  return globalObjects;
}

function getContextualObjects(relativePath: string): string[] {
  if (relativePath.includes('views/partials/') || relativePath.includes('/lib/')) {
    return ['app'];
  }

  return [];
}

function isDefined(
  variableName: string,
  variablePosition: Position,
  fileScopedVariables: Set<string>,
  scopedVariables: Map<string, Scope[]>,
): boolean {
  /**
   * Check if the variable is defined in the file
   */
  if (fileScopedVariables.has(variableName)) {
    return true;
  }

  /**
   * Check if the variable is defined within a specific scope
   */
  const scopes = scopedVariables.get(variableName);

  /**
   * If no specific scopes exist (and it wasn't defined in the file), it's undefined
   */
  if (!scopes) {
    return false;
  }

  /**
   * Check if the variable's usage position falls within any of the defined scopes
   */
  return scopes.some((scope) => isDefinedInScope(variablePosition, scope));
}

function isDefinedInScope(variablePosition: Position, scope: Scope) {
  const start = variablePosition.start;
  const isVariableAfterScopeStart = !scope.start || start > scope.start;
  const isVariableBeforeScopeEnd = !scope.end || start < scope.end;

  return isVariableAfterScopeStart && isVariableBeforeScopeEnd;
}

function isLiquidTag(node?: LiquidHtmlNode): node is LiquidTag {
  return node?.type === NodeTypes.LiquidTag;
}

function isLiquidTagCapture(node: LiquidTag): node is LiquidTagCapture {
  return node.name === NamedTags.capture;
}

function isLiquidTagAssign(node: LiquidTag): node is LiquidTagAssign {
  return node.name === NamedTags.assign && typeof node.markup !== 'string';
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTagHashAssign {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}

function isLiquidTagGraphQL(node: LiquidTag): node is LiquidTagGraphQL {
  return node.name === NamedTags.graphql && typeof node.markup !== 'string';
}

function isLiquidTagParseJson(node: LiquidTag): node is LiquidTagParseJson {
  return node.name === NamedTags.parse_json && typeof node.markup !== 'string';
}

function isLiquidForTag(node: LiquidTag): node is LiquidTagFor {
  return node.name === NamedTags.for && typeof node.markup !== 'string';
}

function isLiquidTableRowTag(node: LiquidTag): node is LiquidTagTablerow {
  return node.name === NamedTags.tablerow && typeof node.markup !== 'string';
}

function isLiquidTagIncrement(node: LiquidTag): node is LiquidTagIncrement {
  return node.name === NamedTags.increment && typeof node.markup !== 'string';
}

function isLiquidTagDecrement(node: LiquidTag): node is LiquidTagDecrement {
  return node.name === NamedTags.decrement && typeof node.markup !== 'string';
}

function isLiquidTagBackground(
  node: LiquidTag,
): node is LiquidTagBackground & { markup: BackgroundMarkup } {
  return (
    node.name === NamedTags.background &&
    typeof node.markup !== 'string' &&
    node.markup.type === NodeTypes.BackgroundMarkup
  );
}

function isFunctionMarkup(node?: LiquidHtmlNode): node is FunctionMarkup {
  return node?.type === NodeTypes.FunctionMarkup;
}
