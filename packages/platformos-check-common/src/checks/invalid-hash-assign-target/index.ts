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
import { UNDOCUMENTED_FILTER_RETURN_TYPES } from '../../undocumented-filters';

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
type VariableType =
  'number' | 'string' | 'boolean' | 'object' | 'array' | 'range' | 'date' | 'time' | 'untyped';

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
 * EXACT MATCH, and everything absent from this table becomes `untyped`. Mapping a
 * spelling by resemblance would be guessing, and this check refuses writes — a wrong
 * guess here is a refusal of working code. An unrecognised return type costs a missed
 * detection, which is the direction that cannot manufacture a false block.
 *
 * THE FOUR ENTRIES BELOW THE LINE WERE ADDED FROM MEASUREMENT, NOT FROM THE SPELLING
 * LOOKING SCALAR-LIKE. Each was rendered on a live instance and its `hash_assign`
 * outcome recorded for both subscripts, and the falsifier — a `date`- or
 * `datetime`-typed value that legitimately accepts `hash_assign` — was looked for and
 * not found:
 *
 *   date             to_date, date_add, add_to_date  -> Date,  raises on both subscripts
 *   datetime         to_time                         -> Time,  raises on both subscripts
 *   time             add_to_time                     -> Time,  raises on both subscripts
 *   array of arrays  parse_csv, parse_csv_rc         -> Array, raises on a key,
 *                                                       RENDERS on an index
 *
 * `datetime` and `time` both resolve to `time` because the runtime returns a Time for
 * both — that is the measurement, not a decision to treat two spellings alike.
 *
 * The measurements are recorded in `filter-return-type-oracle.ts` and re-asserted by
 * `filter-return-type-sweep.spec.ts` for every filter each spelling covers, so a docset
 * change that invalidates one of these fails a test rather than silently changing what
 * the server refuses to write.
 *
 * Still deliberately ABSENT: `untyped` and `'string, nil'`. Those describe values whose
 * type depends on the input or is a union with nil, so no single measurement can
 * establish them and silence remains the only safe reading.
 */
export const DOCSET_RETURN_TYPES: Readonly<Record<string, VariableType>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  hash: 'object',

  date: 'date',
  datetime: 'time',
  time: 'time',
  'array of arrays': 'array',
};

/**
 * Types for filters the DOCSET HAS NO DATA FOR — a data defect, not a modelling choice.
 *
 * `filters.json` carries a `return_type` for every shipped filter but these: `array_index_of`
 * has one whose `type` is the empty string, and `new_line_to_br` has none at all. There is
 * nothing to map, so no entry in {@link DOCSET_RETURN_TYPES} can reach them.
 *
 * THE REAL FIX IS UPSTREAM AND IS NOT AVAILABLE HERE. `data/filters.json` is re-downloaded
 * from documentation.platformos.com by the docs-updater's `postbuild`, so a correction
 * written into that file is reverted by the next build — and would look like the hole was
 * closed while this check quietly went back to reporting nothing. Until the documentation
 * API carries the field, the gap is named here instead of being papered over as if it were
 * a spelling someone chose not to interpret.
 *
 * MEASURED, LIKE EVERYTHING ELSE THAT REPORTS: `array_index_of` returns an Integer and
 * `new_line_to_br` a String, both raising on either subscript. `nl2br` is listed because
 * `AugmentedPlatformOSDocset.expandAliases` re-emits the entry — missing `return_type`
 * included — under the alias name, so the alias has the same hole.
 *
 * APPLIED ONLY WHERE THE DATA IS GENUINELY MISSING, never to an unrecognised spelling —
 * see {@link variableTypeOf}. That keeps this narrowly a workaround for absent data
 * rather than a second, quieter mapping table.
 */
export const DOCSET_RETURN_TYPE_GAPS: Readonly<Record<string, VariableType>> = {
  array_index_of: 'number',
  new_line_to_br: 'string',
  nl2br: 'string',
};

/**
 * The only part of a docset filter entry any of this reads.
 *
 * Structural on purpose, and narrower than the docset's own `ReturnType`: nothing here
 * looks at `name`, `description` or `array_value` on a return type, so requiring them
 * would stop a caller passing the shape it actually has — which is exactly what the
 * shipped `filters.json` and the sweep both do.
 */
type FilterTypeSource = {
  name: string;
  return_type?: ReadonlyArray<Pick<ReturnType, 'type'>>;
};

/**
 * The single type a filter returns, or `untyped` when that cannot be established.
 *
 * A filter declaring SEVERAL return types is an enum-like union; it resolves only
 * when every branch maps to the same thing, because a union of "string or nil" is
 * not a string for the purpose of refusing a write.
 */
function toVariableType(returnTypes: FilterTypeSource['return_type']): VariableType {
  if (!returnTypes || returnTypes.length === 0) return 'untyped';

  const mapped = new Set(returnTypes.map((entry) => DOCSET_RETURN_TYPES[entry.type] ?? 'untyped'));
  const [only] = mapped;
  return mapped.size === 1 ? only : 'untyped';
}

/** Whether the docset simply has no return-type data for this filter. */
function hasNoReturnTypeData(returnTypes: FilterTypeSource['return_type']): boolean {
  if (!returnTypes || returnTypes.length === 0) return true;
  return returnTypes.length === 1 && returnTypes[0].type === '';
}

/**
 * The type a filter produces, as this check models it.
 *
 * THE DOCSET DECIDES FIRST, ALWAYS. Two measured fallbacks fill in behind it, and both
 * apply ONLY where the docset has nothing to say at all. The distinction is the point: an
 * unrecognised SPELLING is a modelling decision this check declines to make and stays
 * `untyped`; an ABSENT field is missing data, which is the one case a measurement is
 * allowed to answer. Letting either fallback win over a spelling would turn it into a
 * second mapping table with weaker rules, which is how the hand-written tables this check
 * used to carry went wrong.
 *
 * The two fallbacks are separate because their PROVENANCE differs, and collapsing them
 * would lose which problem is being worked around:
 *
 *   {@link DOCSET_RETURN_TYPE_GAPS}          the docset HAS the filter, and its
 *                                            `return_type` is empty or absent
 *   `UNDOCUMENTED_FILTER_RETURN_TYPES`       the docset does not have the filter at all;
 *                                            `AugmentedPlatformOSDocset` injects it as a
 *                                            bare `{ name }` from `undocumented-filters.ts`
 *
 * The gap table is consulted first only because it is the narrower population; no name
 * appears in both, and `undocumented-filters.spec.ts` asserts that.
 */
export function variableTypeOf(filter: FilterTypeSource): VariableType {
  if (!hasNoReturnTypeData(filter.return_type)) return toVariableType(filter.return_type);

  const gap = DOCSET_RETURN_TYPE_GAPS[filter.name];
  if (gap) return gap;

  // Measured against the runtime by `verify-undocumented-filters.mjs`, and expressed in
  // the docset's own spelling so it resolves through the SAME table as everything else
  // rather than introducing a second vocabulary.
  const undocumented = UNDOCUMENTED_FILTER_RETURN_TYPES[filter.name];
  return undocumented ? (DOCSET_RETURN_TYPES[undocumented] ?? 'untyped') : 'untyped';
}

/**
 * The subscript applied directly to the target variable, if it can be read statically.
 *
 * ONLY THE FIRST LOOKUP IS MODELLED, and a deeper chain is knowingly out of scope. The
 * runtime walks the WHOLE chain and complains about the intermediate value — measured:
 *
 *   {% assign x = 'a,b' | split: ',' %}{% hash_assign x[0]['k'] = 'v' %}
 *     -> "x[0] is a, expected Hash or Array"
 *
 * Answering that needs the type of `x[0]`, not of `x`, and nothing here tracks element
 * types. Guessing it is worse than silence in both directions: the same measurement shows
 * `x['a'][0]` RENDERS when `x['a']` is a Hash, so "the last subscript must match the
 * container" is not the rule either, and a check built on that assumption would refuse
 * working code.
 *
 * So `x[0]['k']` is a known missed detection, bounded to nested targets, and left alone
 * deliberately rather than by oversight.
 */
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
    case 'date':
    case 'time':
      // The runtime's complaint here is about the TARGET ("x is 5, expected Hash or
      // Array"), so the subscript makes no difference to the outcome. `date` and `time`
      // sit here on the same measured footing as the rest: both were rendered on a live
      // instance and raise "expected Hash or Array" for a key AND for an index.
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
        return new Map(filters.map((filter) => [filter.name, variableTypeOf(filter)]));
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
