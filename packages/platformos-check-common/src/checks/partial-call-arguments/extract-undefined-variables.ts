import {
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagAssign,
  LiquidTagHashAssign,
  AssignMarkup,
  LiquidTagCapture,
  LiquidTagDecrement,
  LiquidTagFor,
  LiquidTagIncrement,
  LiquidTagTablerow,
  LiquidVariableLookup,
  LiquidVariable,
  LiquidFilter,
  NamedTags,
  NodeTypes,
  Position,
  FunctionMarkup,
  LiquidTagGraphQL,
  LiquidTagParseJson,
  LiquidTagBackground,
  BackgroundMarkup,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import { AppFile } from '@platformos/platformos-common';

type Scope = { start?: number; end?: number };

export interface UndefinedVariables {
  /** Read bare: nothing in the file handles their absence. */
  required: string[];
  /** Read through `| default`, either as the defaulted value or as a fallback for one. */
  optional: string[];
  /**
   * Of `optional`, the names the file defaults ITSELF (`x | default: …`), as opposed to the
   * ones that merely stand in for another (`… | default: x`). Only the former is evidence
   * that the file handles a missing `x`: a fallback source is read exactly when the thing it
   * stands in for is absent, which says nothing about its own absence.
   */
  selfDefaulted: string[];
  /**
   * Every name the file gives a value to somewhere — `assign`, `capture`, `for`, a
   * `hash_assign` target, … — whether or not that definition reaches every read of it.
   * A name that is here AND in `required`/`optional` was read where its definition does not
   * reach: a scope error rather than a missing input, and `UndefinedObject`'s to report.
   * This counts as a definition exactly what that check counts, so for a documented partial
   * the two never both report a name, and never both skip one.
   */
  defined: string[];
}

/**
 * Parses a Liquid source string and returns a deduplicated list of variable names
 * that are used but never defined. Returns `{ required: [], optional: [] }` on parse errors.
 *
 * Variables used exclusively with `| default` filter (e.g. `assign x = x | default: val`)
 * are returned in `optional` — the partial handles the missing-argument case itself.
 *
 * This mirrors the variable tracking logic from the UndefinedObject check but
 * packaged as a standalone synchronous function.
 *
 * PURE AND UNMEMOIZED. Callers ask this repeatedly — `PartialCallArguments` analyzes the
 * render TARGET at every call site, so a partial rendered from 40 places is 40 calls — and the
 * memo for that lives on the `AppFile`, through {@link undefinedVariablesOf}. A caller holding
 * a file should use that; this is for a source with no file behind it.
 *
 * `parsed` lets a caller that already holds the parse of THIS source spend no second parse on
 * it. It must be the AST of `source` and of nothing else.
 */
export function extractUndefinedVariables(
  source: string,
  globalObjectNames: string[] = [],
  parsed?: LiquidHtmlNode,
): UndefinedVariables {
  return computeUndefinedVariables(source, globalObjectNames, parsed);
}

/**
 * The same analysis for a file the {@link AppModel} holds, memoized ON that file.
 *
 * The file owns its source and its parse and drops both when either stops being true, so the
 * analysis rides along and needs no key of its own, no copy of the source, and no eviction
 * policy — the `App` already evicts the files nobody is using. What the key does carry is the
 * one input that is NOT the file: the in-scope global names, which vary by the caller's file
 * type and change the answer.
 *
 * Arrays are copied out, so callers keep owning what they receive and cannot mutate the memo.
 */
export function undefinedVariablesOf(
  file: AppFile,
  globalObjectNames: string[] = [],
): UndefinedVariables {
  const analysis = file.derived(`undefinedVariables\u0000${globalObjectNames.join(',')}`, () => {
    const ast = file.ast;
    return computeUndefinedVariables(
      file.source,
      globalObjectNames,
      isLiquidDocument(ast) ? ast : undefined,
    );
  });

  return {
    required: [...analysis.required],
    optional: [...analysis.optional],
    selfDefaulted: [...analysis.selfDefaulted],
    defined: [...analysis.defined],
  };
}

/**
 * An `AppFile`'s `ast` is `unknown` — `platformos-common` sits below the parsers — and holds
 * an `Error` for a file that did not parse, so it is narrowed rather than asserted.
 */
function isLiquidDocument(ast: unknown): ast is LiquidHtmlNode {
  return (
    typeof ast === 'object' && ast !== null && (ast as LiquidHtmlNode).type === NodeTypes.Document
  );
}

function computeUndefinedVariables(
  source: string,
  globalObjectNames: string[],
  parsed?: LiquidHtmlNode,
): UndefinedVariables {
  let ast;
  try {
    ast = parsed ?? toLiquidHtmlAST(source);
  } catch {
    return { required: [], optional: [], selfDefaulted: [], defined: [] };
  }

  const scopedVariables: Map<string, Scope[]> = new Map();
  const fileScopedVariables: Set<string> = new Set(globalObjectNames);
  /** Each USE of a variable — enough of one to place and name it. */
  const variables: { name: string | null; position: Position }[] = [];
  const selfDefaultedVariables: Set<string> = new Set();
  const fallbackSourceVariables: Set<string> = new Set();
  /** Every name the file gives a value to, including the ones it only mutates. */
  const definedVariables: Set<string> = new Set();

  function indexVariableScope(variableName: string | null, scope: Scope) {
    if (!variableName) return;
    definedVariables.add(variableName);
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
    if (isLiquidTagHashAssign(node) && node.markup.target.name) {
      // A mutation READS its target (see `isMutatingAssign`), so the target lookup stays a
      // use; naming it here only records that the file writes to it somewhere.
      definedVariables.add(node.markup.target.name);
    }

    if (isLiquidTagAssign(node)) {
      if (isMutatingAssign(node.markup)) {
        // A mutation, not a definition: the backend looks the target up and raises
        // when it is missing, so this READS the variable.
        variables.push({ name: node.markup.name, position: node.markup.position });
        if (node.markup.name) definedVariables.add(node.markup.name);
      } else {
        indexVariableScope(node.markup.name, {
          start: node.blockStartPosition.end,
        });
      }
    }

    if (isLiquidTagGraphQL(node) || isLiquidTagParseJson(node)) {
      indexVariableScope(node.markup.name, {
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

    if (isLiquidTagFunction(node)) {
      const fnName = node.markup.name;
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
    // `hash_assign x['k'] = v` READS `x` — the backend looks it up and raises if it
    // is null — so the target is a use, never a definition.

    variables.push(node);

    // Detect `x | default: ...` — the variable is the expression of a LiquidVariable
    // that has a `default` filter, meaning the partial handles the missing case itself.
    if (
      node.name &&
      isLiquidVariable(parent) &&
      parent.expression === node &&
      parent.filters.some((f) => f.name === 'default')
    ) {
      selfDefaultedVariables.add(node.name);
    }

    // Detect `... | default: x` — a FALLBACK source cannot be more required than the
    // thing it stands in for, since it is only read when that thing is missing.
    if (
      node.name &&
      isLiquidFilter(parent) &&
      parent.name === 'default' &&
      parent.args.includes(node)
    ) {
      fallbackSourceVariables.add(node.name);
    }
  }

  walk(ast, []);

  // Determine undefined variables
  const seen = new Set<string>();
  const required: string[] = [];
  const optional: string[] = [];
  const selfDefaulted: string[] = [];

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
      if (selfDefaultedVariables.has(variable.name)) {
        optional.push(variable.name);
        selfDefaulted.push(variable.name);
      } else if (fallbackSourceVariables.has(variable.name)) {
        optional.push(variable.name);
      } else {
        required.push(variable.name);
      }
    }
  }

  return { required, optional, selfDefaulted, defined: [...definedVariables] };
}

function isNode(x: any): x is LiquidHtmlNode {
  return x !== null && typeof x === 'object' && typeof x.type === 'string';
}

/**
 * Whether an `assign` mutates its target instead of defining it.
 *
 * `assign x = v` defines `x`. `assign x['k'] = v`, `assign x.k = v` and
 * `assign x << v` all go through the backend's `HashAssignable`, which looks `x` up
 * in the enclosing scopes and raises when it is null — so those need `x` to already
 * exist, exactly as `hash_assign` does.
 */
function isMutatingAssign(markup: AssignMarkup): boolean {
  return markup.lookups.length > 0 || markup.operator === '<<';
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
  return node.name === NamedTags.capture && typeof node.markup !== 'string';
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

/**
 * A `{% function %}` tag whose markup the parser STRUCTURED.
 *
 * The tolerant parser leaves `markup` a raw string when the strict rule fails
 * (`… | dig 'results'`, a filter missing its colon), and the tag name survives that
 * fallback — so a name test alone reaches a string and `markup.name.lookups` throws,
 * which aborted the whole file for whichever check was walking it.
 * `LiquidHTMLSyntaxError` owns telling the author about the markup itself.
 */
function isLiquidTagFunction(node: LiquidTag): node is LiquidTag & { markup: FunctionMarkup } {
  return (
    node.name === NamedTags.function &&
    typeof node.markup !== 'string' &&
    node.markup.type === NodeTypes.FunctionMarkup
  );
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

function isLiquidFilter(node?: LiquidHtmlNode): node is LiquidFilter {
  return node?.type === NodeTypes.LiquidFilter;
}
