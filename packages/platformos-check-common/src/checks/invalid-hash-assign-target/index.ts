import {
  LiquidTag,
  LiquidHtmlNode,
  LiquidVariable,
  LiquidVariableLookup,
  NodeTypes,
  NamedTags,
  HashAssignMarkup,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  FunctionMarkup,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import type { ReturnType } from '../../types/platformos-liquid-docs';
import { isError } from '../../utils';

/**
 * What a variable holds, as far as this check can tell.
 *
 * `range` is deliberately NOT folded into `array`. A range and an array are the same
 * thing to the old hand-written table, but they are not to the runtime: an Array
 * accepts `x[0] = …` and a range was only ever measured raising. Merging them would
 * force a guess in one direction or the other — either approve range index-assign
 * (unmeasured) or refuse array index-assign (measured working).
 *
 * `untyped` means UNKNOWN, not "no type". Nothing is ever reported for it.
 */
type VariableType = 'number' | 'string' | 'boolean' | 'object' | 'array' | 'range' | 'untyped';

/**
 * How the target is subscripted — `x['k']` vs `x[0]` vs `x[y]`.
 *
 * The runtime enforces a rule this check used to ignore entirely: a Hash needs a
 * KEY and an Array needs an INDEX. `x[y]` is `unknown` because the subscript is
 * only decidable at runtime, and an unknown subscript must never produce a report.
 */
type Accessor = 'key' | 'index' | 'unknown';

interface VariableTypeEntry {
  name: string;
  type: VariableType;
  range: [start: number, end?: number];
}

/**
 * Docset `return_type.type` values this check is willing to act on.
 *
 * EXACT MATCH, and everything absent from this table becomes `untyped`. The docset
 * carries twelve distinct spellings across the shipped filters, including `time`,
 * `date`, `datetime`, `'string, nil'`, `'array of arrays'` and an empty string.
 * Mapping those by resemblance would be guessing, and this check refuses writes —
 * a wrong guess here is a refusal of working code. An unrecognised return type
 * costs a missed detection, which is the direction that cannot manufacture a false
 * block.
 */
const DOCSET_RETURN_TYPES: Readonly<Record<string, VariableType>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  hash: 'object',
};

/**
 * The single type a filter returns, or `untyped` when that cannot be established.
 *
 * A filter declaring SEVERAL return types is an enum-like union; it resolves only
 * when every branch maps to the same thing, because a union of "string or nil" is
 * not a string for the purpose of refusing a write.
 */
function toVariableType(returnTypes: ReturnType[] | undefined): VariableType {
  if (!returnTypes || returnTypes.length === 0) return 'untyped';

  const mapped = new Set(returnTypes.map((entry) => DOCSET_RETURN_TYPES[entry.type] ?? 'untyped'));
  const [only] = mapped;
  return mapped.size === 1 ? only : 'untyped';
}

/** The subscript applied directly to the target variable, if it can be read statically. */
function accessorOf(target: LiquidVariableLookup): Accessor {
  const first = target.lookups?.[0];
  if (!first) return 'unknown';
  if (first.type === NodeTypes.String) return 'key';
  if (first.type === NodeTypes.Number) return 'index';
  return 'unknown';
}

/**
 * The offense for this target, or `undefined` when the assignment is fine — or when
 * we cannot tell, which is treated identically ON PURPOSE.
 *
 * Modelled on what the runtime actually enforces, which is two rules, not one:
 * `hash_assign` requires a Hash or an Array, AND the subscript has to match (a Hash
 * takes a key, an Array takes an index). The old check knew only the first, and
 * described even that as "can only be used on object types" — which is not the rule
 * and told an author to convert a working Array into a Hash.
 */
function offenseMessage(name: string, type: VariableType, accessor: Accessor): string | undefined {
  switch (type) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'range':
      // The runtime's complaint here is about the TARGET ("x is 5, expected Hash or
      // Array"), so the subscript makes no difference to the outcome.
      return `Cannot use hash_assign on '${name}', which is a ${type}. hash_assign expects a Hash or an Array.`;

    case 'array':
      // Measured both ways: `x[0] = …` on an Array renders, `x['key'] = …` raises
      // "expected index, key was provided". An unknown subscript stays silent.
      return accessor === 'key'
        ? `Cannot use hash_assign on '${name}' with a string key, because it is an Array. Use a numeric index instead.`
        : undefined;

    case 'object':
    case 'untyped':
      return undefined;
  }
}

export const InvalidHashAssignTarget: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidHashAssignTarget',
    name: 'Invalid hash_assign target',
    docs: {
      description:
        'Reports hash_assign against a target the runtime rejects: a value that is neither a Hash nor an Array, or an Array subscripted with a string key instead of a numeric index.',
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

    /**
     * The return types of every filter the docset knows, keyed by name.
     *
     * Built ONCE per file and memoized, because `filters()` is async and a document
     * can hold many assignments. An absent docset yields an empty map, so every
     * filtered value becomes `untyped` and nothing is reported for it — the check
     * still works on unfiltered assignments, which is the majority of them.
     */
    let returnTypes: Promise<Map<string, VariableType>> | undefined;
    const filterReturnTypes = () => {
      returnTypes ??= (async () => {
        const filters = (await context.platformosDocset?.filters()) ?? [];
        return new Map(filters.map((filter) => [filter.name, toVariableType(filter.return_type)]));
      })();
      return returnTypes;
    };

    /**
     * The type of an assigned value — expression, then whatever the last filter turns
     * it into.
     *
     * FILTER RETURN TYPES COME FROM THE DOCSET, not from a list in this file. There
     * used to be four hand-written arrays here, and they were wrong in the way
     * hand-written tables are: `split` appeared in BOTH the string list and the array
     * list, the string branch ran first, and so
     * `{% assign x = '' | split: ',' %}{% hash_assign x[0] = 'v' %}` — which renders
     * fine — was reported as a hash_assign on a string. Since this check refuses
     * writes, that was a blocking refusal of working code, caused entirely by a typo
     * nobody could see.
     *
     * The docset carries `return_type` for 166 of the 167 shipped filters, so the
     * data already existed. What it does NOT carry is a guarantee of completeness:
     * filters missing from it, and the generated undocumented ones, have no return
     * type at all. Those resolve to `untyped` and produce nothing, which is the only
     * safe reading — see {@link DOCSET_RETURN_TYPES}.
     */
    const inferVariableType = async (variable: LiquidVariable): Promise<VariableType> => {
      const filters = variable.filters;
      if (filters && filters.length > 0) {
        // The LAST filter decides: every earlier one is input to the next.
        const last = filters[filters.length - 1];
        return (await filterReturnTypes()).get(last.name) ?? 'untyped';
      }

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
          // NOT `array` — see the VariableType doc. Measured raising on key-assign;
          // index-assign was never measured, so it stays its own type rather than
          // inheriting Array's permissions.
          return 'range';
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

          const inferredType = await inferVariableType(markup.value);
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
            const existingType = findVariableType(variableName, node.position.start) ?? 'untyped';
            const message = offenseMessage(variableName, existingType, accessorOf(markup.target));

            if (message) {
              context.report({
                message,
                startIndex: markup.target.position.start,
                endIndex: markup.target.position.end,
              });
            }

            // What the variable holds AFTER the assignment. An Array stays an Array —
            // `hash_assign` writes into it, it does not convert it — so a later
            // key-assign on the same variable is still reported. Overwriting it with
            // `object` here (the previous behaviour) silenced exactly that case.
            closeTypeRange(variableName, node.position.start);
            variableTypes.push({
              name: variableName,
              type: existingType === 'array' ? 'array' : 'object',
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
