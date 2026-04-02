import {
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagAssign,
  LiquidTagCapture,
  LiquidTagDecrement,
  LiquidTagFor,
  LiquidTagIncrement,
  LiquidTagTablerow,
  LiquidVariableLookup,
  LiquidVariable,
  NamedTags,
  NodeTypes,
  Position,
  FunctionMarkup,
  LiquidTagHashAssign,
  HashAssignMarkup,
  LiquidTagGraphQL,
  LiquidTagParseJson,
  LiquidTagBackground,
  BackgroundMarkup,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';

type Scope = { start?: number; end?: number };

/**
 * Parses a Liquid source string and returns a deduplicated list of variable names
 * that are used but never defined. Returns `{ required: [], optional: [] }` on parse errors.
 *
 * Variables used exclusively with `| default` filter (e.g. `assign x = x | default: val`)
 * are returned in `optional` — the partial handles the missing-argument case itself.
 *
 * This mirrors the variable tracking logic from the UndefinedObject check but
 * packaged as a standalone synchronous function.
 */
export function extractUndefinedVariables(
  source: string,
  globalObjectNames: string[] = [],
): { required: string[]; optional: string[] } {
  let ast;
  try {
    ast = toLiquidHtmlAST(source);
  } catch {
    return { required: [], optional: [] };
  }

  const scopedVariables: Map<string, Scope[]> = new Map();
  const fileScopedVariables: Set<string> = new Set(globalObjectNames);
  const variables: LiquidVariableLookup[] = [];
  const variablesWithDefault: Set<string> = new Set();

  function indexVariableScope(variableName: string | null, scope: Scope) {
    if (!variableName) return;
    const indexedScope = scopedVariables.get(variableName) ?? [];
    scopedVariables.set(variableName, indexedScope.concat(scope));
  }

  function walk(node: LiquidHtmlNode, ancestors: LiquidHtmlNode[]) {
    // Process definitions from LiquidTag nodes
    if (node.type === NodeTypes.LiquidTag) {
      handleLiquidTag(node, ancestors);
    }

    // Process definitions from LiquidBranch nodes (catch)
    if (node.type === NodeTypes.LiquidBranch) {
      handleLiquidBranch(node);
    }

    // Process variable usages
    if (node.type === NodeTypes.VariableLookup) {
      handleVariableLookup(node, ancestors);
    }

    // Recurse into children
    const newAncestors = ancestors.concat(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) {
            walk(item, newAncestors);
          }
        }
      } else if (isNode(value)) {
        walk(value, newAncestors);
      }
    }
  }

  function handleLiquidTag(node: LiquidTag, _ancestors: LiquidHtmlNode[]) {
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

    if (node.name === 'form') {
      indexVariableScope(node.name, {
        start: node.blockStartPosition.end,
        end: node.blockEndPosition?.start,
      });
    }

    if (node.name === 'function') {
      const fnName = (node.markup as FunctionMarkup).name;
      if (fnName.lookups.length === 0 && fnName.name !== null) {
        indexVariableScope(fnName.name, {
          start: node.position.end,
        });
      }
    }

    if ((isLiquidTagIncrement(node) || isLiquidTagDecrement(node)) && node.markup.name !== null) {
      indexVariableScope(node.markup.name, {
        start: node.position.start,
      });
    }

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
  }

  function handleLiquidBranch(node: LiquidHtmlNode & { type: typeof NodeTypes.LiquidBranch }) {
    if (
      node.name === NamedTags.catch &&
      node.markup &&
      typeof node.markup !== 'string' &&
      'name' in node.markup &&
      (node.markup as any).name
    ) {
      indexVariableScope((node.markup as any).name, {
        start: (node as any).blockStartPosition.end,
        end: (node as any).blockEndPosition?.start,
      });
    }
  }

  function handleVariableLookup(node: LiquidVariableLookup, ancestors: LiquidHtmlNode[]) {
    const parent = ancestors[ancestors.length - 1];

    if (isLiquidTag(parent) && isLiquidTagCapture(parent)) return;
    if (isLiquidTag(parent) && isLiquidTagParseJson(parent)) return;
    if (isFunctionMarkup(parent) && parent.name === node) return;
    if (isLiquidBranchCatch(parent) && parent.markup === node) return;
    if (isHashAssignMarkup(parent) && parent.target === node) return;

    variables.push(node);

    // Detect `x | default: ...` — the variable is the expression of a LiquidVariable
    // that has a `default` filter, meaning the partial handles the missing case itself.
    if (
      node.name &&
      isLiquidVariable(parent) &&
      parent.expression === node &&
      parent.filters.some((f) => f.name === 'default')
    ) {
      variablesWithDefault.add(node.name);
    }
  }

  walk(ast, []);

  // Determine undefined variables
  const seen = new Set<string>();
  const required: string[] = [];
  const optional: string[] = [];

  for (const variable of variables) {
    if (!variable.name) continue;
    if (seen.has(variable.name)) continue;

    const isVariableDefined = isDefined(
      variable.name,
      variable.position,
      fileScopedVariables,
      scopedVariables,
    );

    if (!isVariableDefined) {
      seen.add(variable.name);
      if (variablesWithDefault.has(variable.name)) {
        optional.push(variable.name);
      } else {
        required.push(variable.name);
      }
    }
  }

  return { required, optional };
}

function isNode(x: any): x is LiquidHtmlNode {
  return x !== null && typeof x === 'object' && typeof x.type === 'string';
}

function isDefined(
  variableName: string,
  variablePosition: Position,
  fileScopedVariables: Set<string>,
  scopedVariables: Map<string, Scope[]>,
): boolean {
  if (fileScopedVariables.has(variableName)) {
    return true;
  }

  const scopes = scopedVariables.get(variableName);
  if (!scopes) {
    return false;
  }

  return scopes.some((scope) => {
    const start = variablePosition.start;
    const isVariableAfterScopeStart = !scope.start || start > scope.start;
    const isVariableBeforeScopeEnd = !scope.end || start < scope.end;
    return isVariableAfterScopeStart && isVariableBeforeScopeEnd;
  });
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

function isHashAssignMarkup(node?: LiquidHtmlNode): node is HashAssignMarkup {
  return node?.type === NodeTypes.HashAssignMarkup;
}

function isFunctionMarkup(node?: LiquidHtmlNode): node is FunctionMarkup {
  return node?.type === NodeTypes.FunctionMarkup;
}

function isLiquidBranchCatch(
  node?: LiquidHtmlNode,
): node is LiquidHtmlNode & { type: typeof NodeTypes.LiquidBranch; name: 'catch'; markup: any } {
  return node?.type === NodeTypes.LiquidBranch && (node as any).name === NamedTags.catch;
}

function isLiquidVariable(node?: LiquidHtmlNode): node is LiquidVariable {
  return node?.type === NodeTypes.LiquidVariable;
}
