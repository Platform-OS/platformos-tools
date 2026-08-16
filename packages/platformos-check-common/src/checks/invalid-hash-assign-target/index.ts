import {
  AssignMarkup,
  LiquidTag,
  LiquidExpression,
  NodeTypes,
  NamedTags,
  HashAssignMarkup,
  FunctionMarkup,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { docsetReturnType, FilterTypeSource, LiquidType } from '../../liquid-types';
import { variableTypeSources, variableTypesOf } from '../../variable-types';
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

    /**
     * What the variable holds where the tag is written, from the file's ONE type table.
     *
     * This check used to keep that table privately — ranges, narrowing, a literal switch and a
     * docset lookup, none of it reachable from anywhere else — while `ValidFilterArgumentTypes`,
     * `ValidTagArgumentTypes` and `ValidRenderPartialArgumentTypes` each reported nothing at all
     * for a variable, on the stated grounds that no such table existed. It is shared now, and the
     * rules that were only here (the inclusive start bound, the narrowing below) and the rules
     * that were only in `shape-analysis` (branch scoping, loop shadowing, forgetting on an
     * unreadable tag) are both in it.
     *
     * The position is the tag's START, which is where the PREVIOUS binding is still current — this
     * tag's own effect on the table begins at its end.
     */
    const typeAt = async (name: string, node: LiquidTag): Promise<VariableType> => {
      const [variables, sources] = await Promise.all([
        variableTypesOf(context.file),
        variableTypeSources(context.platformosDocset),
      ]);

      return variables.typeAt(name, node.position.start, sources);
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
              const message = subscriptWriteMessage(
                'assign',
                markup.name,
                await typeAt(markup.name, node),
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
          } else if (markup.operator === '<<') {
            const message = appendMessage(markup.name, await typeAt(markup.name, node));

            if (message) {
              context.report({
                message,
                startIndex: markup.position.start,
                endIndex: markup.position.end,
              });
            }
          }
          return;
        }

        // {% function result = 'path' %}
        //
        // A SUBSCRIPT TARGET (`{% function h['k'] = 'path' %}`) parses — measured, all eight
        // spellings reach partial resolution rather than a syntax error — but what the write
        // then does is UNMEASURED: settling it needs a partial that exists, and the oracle
        // instance has none. So the target is not JUDGED, which costs missed detections — the
        // direction that cannot manufacture a false block in a check that refuses writes.
        //
        // `{% function items << 'path' %}` IS judged: it is the same append the `assign` branch
        // judges and raises for the same reason, the runtime refusing `<<` onto anything but an
        // Array. Only a PLAIN target, matching `appendMessage`'s documented scope — an append
        // through a subscript is checked by the runtime at the subscript, and nothing tracks
        // element types.
        if (isLiquidTagFunction(node)) {
          const markup = node.markup;
          const varName = markup.name.name;

          if (varName && markup.operator === '<<' && markup.name.lookups.length === 0) {
            const message = appendMessage(varName, await typeAt(varName, node));

            if (message) {
              context.report({
                message,
                startIndex: markup.position.start,
                endIndex: markup.position.end,
              });
            }
          }
          return;
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
              await typeAt(variableName, node),
              accessorOf(markup.target.lookups ?? []),
            );

            if (message) {
              context.report({
                message,
                startIndex: markup.target.position.start,
                endIndex: markup.target.position.end,
              });
            }
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

function isLiquidTagFunction(node: LiquidTag): node is LiquidTag & { markup: FunctionMarkup } {
  return node.name === NamedTags.function && typeof node.markup !== 'string';
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}
