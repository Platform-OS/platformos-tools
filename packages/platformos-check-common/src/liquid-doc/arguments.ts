/**
 * Helper methods shared between `render` tag and `content_for` tag to report
 * errors when LiquidDoc exists
 */
import {
  RenderMarkup,
  FunctionMarkup,
  LiquidNamedArgument,
  NodeTypes,
} from '@platformos/liquid-html-parser';
import { Context, LiquidDocParameter, SourceCodeType, StringCorrector } from '..';
import {
  getDefaultValueForType,
  inferArgumentType,
  isNullLiteral,
  isTypeCompatible,
} from './utils';
import { DECLARABLE_TYPES, LiquidType } from '../liquid-types';
import { VariableTypeSources, VariableTypes } from '../variable-types';
import { CallSiteTag, isLiquidString } from '../checks/utils';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { relative } from '../path';

/**
 * Which call site an offense is about, in the words the author wrote it in. `include` and
 * `render` share a node type, so the tag has to be handed in (`callSiteTag`) rather than
 * read off the node — telling someone about a "render tag" they did not write sends them
 * looking for a tag that is not there.
 */
function callSiteDescription(tag: CallSiteTag, partialName: string) {
  return ` in ${tag} tag for partial '${partialName}'`;
}

/**
 * Report error when unknown arguments are provided for `content_for` tag or `render` tag
 */
export function reportUnknownArguments(
  context: Context<SourceCodeType.LiquidHtml>,
  node: RenderMarkup | FunctionMarkup,
  unknownProvidedArgs: LiquidNamedArgument[],
  name: string,
  tag: CallSiteTag,
) {
  const errorOwnerMessage = callSiteDescription(tag, name);

  for (const arg of unknownProvidedArgs) {
    context.report({
      message: `Unknown argument '${arg.name}'${errorOwnerMessage}.`,
      startIndex: arg.position.start,
      endIndex: arg.position.end,
      suggest: [
        {
          message: `Remove '${arg.name}'`,
          fix: makeRemoveArgumentCorrector(node, arg),
        },
      ],
    });
  }
}

/**
 * Report error when missing arguments are provided for `content_for` tag or `render` tag
 */
export function reportMissingArguments(
  context: Context<SourceCodeType.LiquidHtml>,
  node: RenderMarkup | FunctionMarkup,
  missingRequiredArgs: LiquidDocParameter[],
  name: string,
  tag: CallSiteTag,
) {
  const errorOwnerMessage = callSiteDescription(tag, name);

  for (const arg of missingRequiredArgs) {
    context.report({
      message: `Missing required argument '${arg.name}'${errorOwnerMessage}.`,
      startIndex: node.position.start,
      endIndex: node.position.end,
      suggest: [
        {
          message: `Add required argument '${arg.name}'`,
          fix: makeAddArgumentCorrector(node, arg),
        },
      ],
    });
  }
}

export function reportDuplicateArguments(
  context: Context<SourceCodeType.LiquidHtml>,
  node: RenderMarkup | FunctionMarkup,
  duplicateArgs: LiquidNamedArgument[],
  name: string,
  tag: CallSiteTag,
) {
  const errorOwnerMessage = callSiteDescription(tag, name);

  for (const arg of duplicateArgs) {
    context.report({
      message: `Duplicate argument '${arg.name}'${errorOwnerMessage}.`,
      startIndex: arg.position.start,
      endIndex: arg.position.end,
      suggest: [
        {
          message: `Remove duplicate argument '${arg.name}'`,
          fix: makeRemoveArgumentCorrector(node, arg),
        },
      ],
    });
  }
}

/**
 * Find type mismatch between the arguments provided for `content_for` tag and `render` tag
 * and their associated file's LiquidDoc
 *
 * `returnTypes` is the docset's filter → return type map, which is what lets a filtered argument
 * be judged at all; without one every filtered argument infers `untyped` and stays silent.
 */
export function findTypeMismatchParams(
  liquidDocParameters: Map<string, LiquidDocParameter>,
  providedParams: LiquidNamedArgument[],
  returnTypes?: ReadonlyMap<string, LiquidType>,
  variables?: CallSiteVariables,
) {
  const typeMismatchParams: LiquidNamedArgument[] = [];

  for (const arg of providedParams) {
    if (arg.value.type === NodeTypes.NamedArgument) continue;

    // null/nil is compatible with any type — skip type checking
    if (isNullLiteral(arg.value)) {
      continue;
    }

    const liquidDocParamDef = liquidDocParameters.get(arg.name);
    if (liquidDocParamDef && liquidDocParamDef.type) {
      const paramType = liquidDocParamDef.type.toLowerCase();
      // A declared type inference cannot produce — an object name like `{current_user}`, or the
      // `{string[]}` array spelling — is DECLARABLE but not enforced here, and that silence is
      // deliberate rather than accidental: the docset accepts far more names than this file knows what
      // satisfies. Widening it is its own change.
      if (!DECLARABLE_TYPES.has(paramType as LiquidType)) {
        continue;
      }

      if (!isTypeCompatible(paramType, argumentType(arg.value, returnTypes, variables))) {
        typeMismatchParams.push(arg);
      }
    }
  }

  return typeMismatchParams;
}

/** What the CALLER's file knows about the names it is passing, when it knows anything. */
export interface CallSiteVariables {
  types: VariableTypes;
  sources: VariableTypeSources;
}

/**
 * The type of a value written at a call site, the call site's own file included.
 *
 * A BARE variable lookup used to be skipped outright, because there was no symbol table at a call
 * site — `title: page_title` said nothing about what `page_title` held. There is one now, so
 * `{% assign page_title = 403 %}{% render 'card', title: page_title %}` is judged against the
 * partial's `@param {string} title` exactly as `title: 403` already was. A name the caller's file
 * never binds is `untyped`, and so is a lookup INTO one.
 *
 * A FILTERED value resolves from the last filter's published return type, which does not depend on
 * its input — so `title: name | append: '!'` is a string whatever `name` is.
 *
 * `inferArgumentType` is what answers everything else, and must NOT be reached for a lookup: it
 * answers `object`, the right answer for a `@param {object}` and a report of every variable
 * argument in the codebase from here.
 */
export function argumentType(
  value: LiquidNamedArgument['value'],
  returnTypes?: ReadonlyMap<string, LiquidType>,
  variables?: CallSiteVariables,
): LiquidType {
  const lookup =
    value.type === NodeTypes.VariableLookup
      ? value
      : value.type === NodeTypes.LiquidVariable && value.filters.length === 0
        ? value.expression
        : undefined;

  if (lookup?.type === NodeTypes.VariableLookup) {
    if (!variables || !lookup.name || lookup.lookups.length > 0) return 'untyped';
    return variables.types.typeAt(lookup.name, lookup.position.start, variables.sources);
  }

  if (value.type === NodeTypes.NamedArgument) return 'untyped';

  return inferArgumentType(value, returnTypes);
}

/**
 * Report error if the type mismatches between LiquidDoc and provided arguments
 */
export function reportTypeMismatches(
  context: Context<SourceCodeType.LiquidHtml>,
  typeMismatchArgs: LiquidNamedArgument[],
  liquidDocParameters: Map<string, LiquidDocParameter>,
  returnTypes?: ReadonlyMap<string, LiquidType>,
  variables?: CallSiteVariables,
) {
  for (const arg of typeMismatchArgs) {
    const paramDef = liquidDocParameters.get(arg.name);
    if (!paramDef || !paramDef.type) continue;
    if (arg.value.type === NodeTypes.NamedArgument) continue;

    const expectedType = paramDef.type.toLowerCase();
    // The SAME inputs the mismatch was found with. Resolving again without them would name the
    // type `untyped` in a message about a mismatch only a resolved type could have produced.
    const actualType = argumentType(arg.value, returnTypes, variables);

    const suggestions = generateTypeMismatchSuggestions(
      expectedType,
      arg.value.position.start,
      arg.value.position.end,
    );

    context.report({
      message: `Type mismatch for argument '${arg.name}': expected ${expectedType}, got ${actualType}`,
      startIndex: arg.value.position.start,
      endIndex: arg.value.position.end,
      suggest: suggestions,
    });
  }
}

/**
 * Generates suggestions for type mismatches based on the expected type and node positions
 */
export function generateTypeMismatchSuggestions(
  expectedType: string,
  startPosition: number,
  endPosition: number,
) {
  const defaultValue = getDefaultValueForType(expectedType);
  const suggestions = [];

  // Only add the "replace with default" suggestion if the default is not an empty string
  if (defaultValue !== '') {
    suggestions.push({
      message: `Replace with default value '${defaultValue}' for ${expectedType}`,
      fix: (fixer: StringCorrector) => {
        return fixer.replace(startPosition, endPosition, defaultValue);
      },
    });
  }

  // Always include the "remove value" suggestion
  suggestions.push({
    message: `Remove value`,
    fix: (fixer: StringCorrector) => {
      return fixer.remove(startPosition, endPosition);
    },
  });

  return suggestions;
}

function isLastArg(node: RenderMarkup | FunctionMarkup, arg: LiquidNamedArgument): boolean {
  return (
    node.args.length == 1 || arg.position.start == node.args[node.args.length - 1].position.start
  );
}

export function getPartialName(node: RenderMarkup | FunctionMarkup): string | undefined {
  if (node.type === NodeTypes.RenderMarkup) {
    if (!isLiquidString(node.partial)) {
      return;
    }
    return node.partial.value;
  }

  if (node.type === NodeTypes.FunctionMarkup) {
    if (!isLiquidString(node.partial)) {
      return;
    }
    return node.partial.value;
  }
}

export async function getLiquidDocParams(
  context: Context<SourceCodeType.LiquidHtml>,
  partialName: string,
) {
  if (!context.getDocDefinition) return;

  // Use DocumentsLocator to find the partial across all platformOS locations,
  // including app/views/partials/, app/lib/, and module paths.
  const locator = new DocumentsLocator(context.fs, context.app);
  const fileUri = await locator.locate(URI.parse(context.config.rootUri), 'render', partialName);
  if (!fileUri) return undefined;

  const relativePath = relative(fileUri, context.config.rootUri);
  const docDefinition = await context.getDocDefinition(relativePath);
  if (docDefinition?.liquidDoc?.parameters) {
    return new Map(docDefinition.liquidDoc.parameters.map((p) => [p.name, p]));
  }

  return undefined;
}

export function makeRemoveArgumentCorrector(
  node: RenderMarkup | FunctionMarkup,
  arg: LiquidNamedArgument,
) {
  return (fixer: StringCorrector) => {
    const sourceBeforeArg = node.source.slice(node.position.start, arg.position.start);
    const matches = sourceBeforeArg.match(/,\s*/g);
    const lastCommaMatch = matches?.[matches.length - 1];
    let startPos = lastCommaMatch
      ? arg.position.start - (lastCommaMatch.length - 1)
      : arg.position.start;

    if (isLastArg(node, arg)) {
      // Remove the leading comma if it's the last parameter
      startPos -= 1;
    }

    const sourceAfterArg = node.source.substring(arg.position.end, node.position.end);
    const trailingCommaMatch = sourceAfterArg.match(/\s*,/);
    if (trailingCommaMatch) {
      return fixer.remove(startPos, arg.position.end + trailingCommaMatch[0].length);
    }
    return fixer.remove(startPos, arg.position.end);
  };
}

export function makeAddArgumentCorrector(
  node: RenderMarkup | FunctionMarkup,
  arg: LiquidDocParameter,
) {
  return (fixer: StringCorrector) => {
    const paramToAdd = `, ${arg.name}: ${getDefaultValueForType(arg.type)}`;

    if (node.args.length == 0) {
      return fixer.insert(node.position.end - 1, paramToAdd);
    }

    const lastArg = node.args[node.args.length - 1];
    const sourceAfterLastArg = node.source.substring(lastArg.position.end, node.position.end);

    const trailingCommaAndWhitespaceMatch = sourceAfterLastArg.match(/\s*,\s*/);
    if (trailingCommaAndWhitespaceMatch) {
      // IF there is already a trailing comma after the last arg, we want to find it and replace it with our own while stripping whitespace
      return fixer.replace(
        lastArg.position.end,
        lastArg.position.end + trailingCommaAndWhitespaceMatch[0].length,
        `${paramToAdd} `,
      );
    }

    return fixer.insert(lastArg.position.end, paramToAdd);
  };
}
