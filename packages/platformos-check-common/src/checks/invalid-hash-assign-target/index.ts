import {
  AssignMarkup,
  LiquidTag,
  LiquidExpression,
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
import {
  docsetReturnType,
  filterChainType,
  filterReturnTypes,
  FilterTypeSource,
  LiquidType,
} from '../../liquid-types';
import { isError } from '../../utils';

/**
 * What a variable holds, as far as this check can tell.
 *
 * The monorepo's one type vocabulary, which used to be declared here and in `liquid-doc/utils.ts`
 * as two overlapping sets. `range` is deliberately NOT folded into `array`: an Array accepts
 * `x[0] = …` and a range was only ever measured raising.
 *
 * `untyped` means UNKNOWN, not "no type". Nothing is ever reported for it.
 */
type VariableType = LiquidType;

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
 * The type a filter produces, or `untyped` when the docset does not say.
 *
 * An unrecognised SPELLING stays `untyped` rather than being guessed at: this check refuses writes,
 * so a wrong guess refuses working code. The table it resolves through — `DOCSET_TYPES`, legacy
 * spellings included — is shared with every other consumer of a published type; it lived here until
 * a second copy of the same knowledge grew in `liquid-doc/utils.ts`.
 */
export function variableTypeOf(filter: FilterTypeSource): VariableType {
  return docsetReturnType(filter);
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
function accessorOf(lookups: readonly LiquidExpression[]): Accessor {
  const first = lookups[0];
  if (!first) return 'unknown';
  if (first.type === NodeTypes.String) return 'key';
  if (first.type === NodeTypes.Number) return 'index';
  return 'unknown';
}

/**
 * The offense for a SUBSCRIPT WRITE — `tag x[…] = value` — or `undefined` when the write is
 * fine, or when we cannot tell, which is treated identically ON PURPOSE.
 *
 * Modelled on what the runtime actually enforces, which is two rules, not one: the container
 * must be a Hash or an Array, AND the subscript has to match (a Hash takes a key, an Array
 * takes an index). "Can only be used on object types" is not the rule, and telling an author
 * to convert a working Array into a Hash is a refusal of working code.
 *
 * `tag` is a parameter because `hash_assign` and `assign` reach the same runtime setter and
 * the author needs to read their own spelling back — see {@link SUBSCRIPT_WRITE_TAGS}.
 */
function subscriptWriteMessage(
  tag: string,
  name: string,
  type: VariableType,
  accessor: Accessor,
): string | undefined {
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
      return `Cannot use ${tag} on '${name}', which is a ${type}. ${tag} expects a Hash or an Array.`;

    case 'array':
      // Measured both ways: `x[0] = …` on an Array renders, `x['key'] = …` raises
      // "expected index, key was provided". An unknown subscript stays silent.
      return accessor === 'key'
        ? `Cannot use ${tag} on '${name}' with a string key, because it is an Array. Use a numeric index instead.`
        : undefined;

    case 'object':
    case 'untyped':
      return undefined;
  }
}

/**
 * The offense for an APPEND — `{% assign x << value %}` — which is a different rule from a
 * subscript write and shares nothing with it but the tag name.
 *
 * MEASURED across every container, and the Hash row is the falsifier that proves the two are
 * not the same rule: `=` wants a Hash and refuses a scalar, `<<` wants an Array and refuses a
 * Hash.
 *
 *   {% parse_json x %}[1]{% endparse_json %}{% assign x << 2 %}   appends, x stays an Array
 *   {% parse_json x %}{}{% endparse_json %} {% assign x << 1 %}   raises "x is {}, expected Array"
 *   {% assign x = 'a' %}                    {% assign x << 'b' %} raises "x is a, expected Array"
 *   {% assign x = 1 %}                      {% assign x << 2 %}   raises "x is 1, expected Array"
 *   (x never assigned)                      {% assign x << 1 %}   raises "x is null, expected Array"
 *
 * An append THROUGH a subscript (`{% assign x['k'] << v %}`) is NOT this rule and is not
 * reported at all: the runtime checks the value AT the subscript — measured, "x[k] is null,
 * expected Array" — and nothing here tracks element types.
 */
function appendMessage(name: string, type: VariableType): string | undefined {
  switch (type) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'range':
    case 'date':
    case 'time':
    case 'object':
      return `Cannot use '<<' on '${name}', which is a ${type === 'object' ? 'Hash' : type}. '<<' appends to an Array.`;

    case 'array':
    case 'untyped':
      return undefined;
  }
}

/**
 * Where the TARGET ends in the source, for a tag whose markup carries no node spanning it.
 *
 * `AssignMarkup` records the variable NAME and its lookups separately, and a bracket lookup's
 * node begins INSIDE the brackets — so the last lookup's end is one short of the `]` for
 * `x['k']` and exactly right for `x.k`. Reading the gap rather than adding a fixed offset keeps
 * this correct across the whitespace the grammar permits: `x [ 'k' ]` parses.
 */
function targetEndOf(source: string, lookups: readonly LiquidExpression[]): number {
  const last = lookups[lookups.length - 1];
  let index = last.position.end;
  while (index < source.length && /\s/.test(source[index])) index++;
  return source[index] === ']' ? index + 1 : last.position.end;
}

/**
 * The tags that write THROUGH a subscript, and why they share one rule.
 *
 * `hash_assign` is the older, deprecated spelling; `assign` gained the same ability and is what
 * an author should reach for now. They are not merely similar — MEASURED against
 * `/api/app_builder/liquid_exec`, every container × subscript combination behaves identically,
 * with the container read back after the write so acceptance means the write happened:
 *
 *                        x['k'] = 'V'        x[0] = 'V'        x.k = 'V'
 *   Hash                 writes              writes (key "0")  writes
 *   Array                raises, wants index writes            raises, wants index
 *   String/Number/       raises, "expected Hash or Array" for every subscript
 *   Boolean/nil/unset
 *
 * The ONE difference is notation, not semantics: `hash_assign x.k` raises a PARSE-time
 * `Syntax Error in 'hash_assign'`, while `assign x.k` writes the key `k`. That belongs to
 * `InvalidHashAssignTargetSyntax`, which is why it is not modelled here — a dot lookup is a
 * plain KEY accessor for the purposes of this check, exactly as the runtime treats it.
 */
const SUBSCRIPT_WRITE_TAGS = 'hash_assign, assign';

export const InvalidHashAssignTarget: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidHashAssignTarget',
    name: 'Invalid hash write target',
    docs: {
      description: `Reports a write through a subscript (${SUBSCRIPT_WRITE_TAGS}) against a target the runtime rejects: a value that is neither a Hash nor an Array, or an Array subscripted with a string key instead of a numeric index. Also reports '<<' against a target that is not an Array.`,
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
     * Cached on the docset's own filters array rather than per file: `filters()` is memoized by
     * `AugmentedPlatformOSDocset`, so one map serves every file in a run. An absent docset yields
     * `undefined`, so every filtered value becomes `untyped` and nothing is reported for it — the
     * check still works on unfiltered assignments, which is the majority of them.
     */
    const returnTypes = async () =>
      context.platformosDocset
        ? filterReturnTypes(await context.platformosDocset.filters())
        : undefined;

    /**
     * The type of an assigned value — expression, then whatever the last filter turns
     * it into.
     *
     * FILTER RETURN TYPES COME FROM THE DOCSET, and a list of filter names must never
     * be reintroduced here. This check REFUSES WRITES, so a name in the wrong bucket is
     * a blocking refusal of working code — and a duplicate is invisible by construction,
     * since nothing about a hand-written array makes two entries for one filter look
     * wrong. `index.spec.ts` pins the case that cost us this once: a `split` result
     * subscripted by index must stay silent.
     *
     * What the docset does NOT carry is a guarantee of completeness. A filter it omits,
     * or one whose `return_type` it cannot state, has no type here at all: those resolve
     * to `untyped` and produce nothing, which is the only safe reading — see `DOCSET_TYPES`.
     *
     * THE LITERAL CASES BELOW ARE THIS CHECK'S OWN, and deliberately not shared with
     * `inferArgumentType`, which answers a different question. Here the question is "what container
     * is this", where a wrong answer BLOCKS a write: `empty` and a bare lookup are `untyped` because
     * nothing is known about what they hold. There the question is "does this value satisfy a
     * declared parameter", where `empty` is the empty string and a lookup is the generic `object`.
     * Only the vocabulary and the docset lookup are shared.
     */
    const inferVariableType = async (variable: LiquidVariable): Promise<VariableType> => {
      const filters = variable.filters;
      if (filters && filters.length > 0) {
        return filterChainType(filters, await returnTypes());
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

    /**
     * Record what a variable holds AFTER a write that goes INTO it rather than replacing it.
     *
     * A subscript write and an append both leave the container in place, so the variable does
     * NOT take the value's type — which is the whole difference from a plain `{% assign %}`.
     * Getting this wrong is a false block rather than a missed detection: rebinding `h` to
     * `string` after `{% assign h['k'] = 'V' %}` makes the very next `hash_assign` on the same
     * hash look like a write onto a string, and this check refuses writes.
     *
     * The type is NARROWED, not merely kept. A write that reaches the runtime at all proves the
     * container was of the right kind, so an untyped variable becomes what the operation
     * requires — an Array for `<<`, a Hash for a subscript write unless it was already an Array,
     * which a subscript write does not convert.
     *
     * The language server's `TypeSystem` already modelled this — its `AssignMarkup` visitor
     * returns `Untyped` for exactly these two shapes — so hover and completion were right while
     * the check that BLOCKS was wrong. Worth knowing before adding a third model of the same
     * question somewhere else.
     */
    const narrowAfterWriteInto = (name: string, node: LiquidTag, becomes: 'array' | 'hash') => {
      const existing = findVariableType(name, node.position.start) ?? 'untyped';
      closeTypeRange(name, node.position.start);
      variableTypes.push({
        name,
        type: becomes === 'array' || existing === 'array' ? 'array' : 'object',
        range: [node.position.end],
      });
    };

    return {
      async LiquidTag(node: LiquidTag) {
        // {% assign x = value %}, {% assign x[…] = value %}, {% assign x << value %}
        if (isLiquidTagAssign(node)) {
          const markup = node.markup;
          const lookups = markup.lookups ?? [];

          if (lookups.length > 0) {
            // A SUBSCRIPT WRITE, measured identical to `hash_assign` in every container ×
            // subscript combination — so it answers to the same rule, reported under the
            // author's own spelling. `<<` through a subscript is deliberately absent: the
            // runtime asks about the value AT the subscript, not about the container.
            if (markup.operator === '=') {
              const name = markup.name;
              const message = subscriptWriteMessage(
                'assign',
                name,
                findVariableType(name, node.position.start) ?? 'untyped',
                accessorOf(lookups),
              );

              if (message) {
                context.report({
                  message,
                  startIndex: markup.position.start,
                  endIndex: targetEndOf(node.source, lookups),
                });
              }
            }

            narrowAfterWriteInto(markup.name, node, 'hash');
          } else if (markup.operator === '<<') {
            const message = appendMessage(
              markup.name,
              findVariableType(markup.name, node.position.start) ?? 'untyped',
            );

            if (message) {
              context.report({
                message,
                startIndex: markup.position.start,
                endIndex: markup.position.end,
              });
            }

            narrowAfterWriteInto(markup.name, node, 'array');
          } else {
            // A plain assignment REPLACES the variable, so it takes the value's type.
            closeTypeRange(markup.name, node.position.start);
            variableTypes.push({
              name: markup.name,
              type: await inferVariableType(markup.value),
              range: [node.position.end],
            });
          }
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
        //
        // A SUBSCRIPT TARGET (`{% function h['k'] = 'path' %}`) parses — measured, all eight
        // spellings reach partial resolution rather than a syntax error — but what the write
        // then does is UNMEASURED: settling it needs a partial that exists, and the oracle
        // instance has none. So the target is not JUDGED. It is not forgotten either: the
        // container keeps its type, exactly as the `assign` branch does for the same shape.
        // Not judging costs missed detections, which is the direction that cannot manufacture a
        // false block in a check that refuses writes; forgetting the type also silenced the
        // WRITES AFTER IT, which is a different and much worse trade.
        if (node.name === NamedTags.function && typeof node.markup !== 'string') {
          const markup = node.markup as FunctionMarkup;
          const varName = markup.name.name;
          if (varName) {
            /**
             * `{% function items << 'path' %}` is the SAME append the `assign` branch judges, and
             * it raises for the same reason — the runtime refuses `<<` onto anything but an Array.
             * It went unjudged because the operator did not exist on this tag until the append
             * form began to parse, so an append onto a String or a Hash passed the write gate
             * while the identical `{% assign %}` was refused.
             *
             * Only a PLAIN target, matching `appendMessage`'s documented scope: an append through
             * a subscript is checked by the runtime at the subscript, and nothing here tracks
             * element types.
             */
            if (markup.operator === '<<' && markup.name.lookups.length === 0) {
              const message = appendMessage(
                varName,
                findVariableType(varName, node.position.start) ?? 'untyped',
              );

              if (message) {
                context.report({
                  message,
                  startIndex: markup.position.start,
                  endIndex: markup.position.end,
                });
              }

              narrowAfterWriteInto(varName, node, 'array');
            } else if (markup.name.lookups.length > 0) {
              /**
               * A SUBSCRIPT TARGET. The write is not judged — see the note above — but the
               * container must KEEP the type it had, which is what the `assign` branch does for
               * the identical shape via `narrowAfterWriteInto(…, 'hash')`.
               *
               * Rebinding it to `untyped` here erased that type and blinded this BLOCKING check
               * to the next real error:
               *
               *   {% assign x = {} %}{% function x['k'] << 'p' %}{% assign x << 'v' %}
               *
               * reported nothing, while dropping the middle tag — or spelling it `{% assign %}` —
               * reported "Cannot use '<<' on 'x', which is a Hash." Unreachable before the append
               * form parsed, because the whole branch was skipped while the markup was a string.
               */
              narrowAfterWriteInto(varName, node, 'hash');
            } else {
              closeTypeRange(varName, node.position.start);
              // A plain target takes the partial's RETURN value, which is untyped unless we can
              // infer it — so, unlike a subscript write, it genuinely replaces what was there.
              variableTypes.push({
                name: varName,
                type: 'untyped',
                range: [node.position.end],
              });
            }
          }
        }

        // {% hash_assign x['key'] = value %} — the same subscript write, under the older,
        // deprecated spelling, which additionally REFUSES a dot target at parse time. That
        // refusal is `InvalidHashAssignTargetSyntax`'s to report, not this check's.
        if (isLiquidTagHashAssign(node)) {
          const markup = node.markup;
          const variableName = markup.target.name;

          if (variableName) {
            const message = subscriptWriteMessage(
              'hash_assign',
              variableName,
              findVariableType(variableName, node.position.start) ?? 'untyped',
              accessorOf(markup.target.lookups ?? []),
            );

            if (message) {
              context.report({
                message,
                startIndex: markup.target.position.start,
                endIndex: markup.target.position.end,
              });
            }

            narrowAfterWriteInto(variableName, node, 'hash');
          }
        }
      },
    };
  },
};

// Type guards
function isLiquidTagAssign(node: LiquidTag): node is LiquidTag & { markup: AssignMarkup } {
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
