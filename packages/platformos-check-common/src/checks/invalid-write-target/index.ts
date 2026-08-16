import { LiquidExpression, LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';

import { LiquidType } from '../../liquid-types';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { assertNever } from '../../utils';
import { variableTypeSources, variableTypesOf } from '../../variable-types';
import { writeTargetOf } from '../../write-targets';

/**
 * How the target is subscripted — `x['k']` vs `x[0]` vs `x[y]`.
 *
 * A Hash needs a KEY and an Array needs an INDEX. `unknown` never reports: the subscript is only
 * decidable at runtime.
 */
type Accessor = 'key' | 'index' | 'unknown';

/** A write that goes INTO a container, normalised across the three tags that spell one. */
type ContainerWrite =
  | { rule: 'subscript'; name: string; accessor: Accessor; start: number; end: number }
  | { rule: 'append'; name: string; start: number; end: number };

/**
 * The offense for a SUBSCRIPT WRITE — `x[…] = value` — or `undefined` when the write is fine, or
 * when we cannot tell, which is treated identically ON PURPOSE.
 *
 * Two rules, not one: the container must be a Hash or an Array, AND the subscript has to match.
 * Telling an author to convert a working Array into a Hash is a refusal of working code.
 */
function subscriptWriteMessage(
  name: string,
  type: LiquidType,
  accessor: Accessor,
): string | undefined {
  switch (type) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'range':
    case 'date':
    case 'time':
      // The runtime complains about the TARGET ("x is 5, expected Hash or Array"), so the
      // subscript makes no difference to the outcome.
      return `Cannot write into '${name}', which is a ${type}. A subscript write needs a Hash or an Array.`;

    case 'array':
      return accessor === 'key'
        ? `Cannot write into '${name}' with a string key, because it is an Array. Use a numeric index instead.`
        : undefined;

    // `null` is unmeasured against the platform, so it is silent — a deliberate gap rather than a
    // case that was forgotten, which is what `assertNever` below makes it.
    case 'null':
    case 'object':
    case 'untyped':
      return undefined;

    default:
      return assertNever(type);
  }
}

/**
 * The offense for an APPEND — `x << value` — which is a different rule from a subscript write and
 * shares nothing with it but the tags that spell both.
 *
 * `=` wants a Hash and refuses a scalar; `<<` wants an Array and refuses a Hash.
 */
function appendMessage(name: string, type: LiquidType): string | undefined {
  switch (type) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'range':
    case 'date':
    case 'time':
    case 'object':
      return `Cannot use '<<' on '${name}', which is a ${type === 'object' ? 'Hash' : type}. '<<' appends to an Array.`;

    // `null` is unmeasured, as above.
    case 'null':
    case 'array':
    case 'untyped':
      return undefined;

    default:
      return assertNever(type);
  }
}

/**
 * ONLY THE FIRST LOOKUP IS MODELLED. The runtime walks the whole chain and complains about the
 * INTERMEDIATE value, which needs the type of `x[0]` rather than of `x`, and nothing here tracks
 * element types. See the "nested subscript" cases in the spec for why guessing is worse than
 * silence in both directions.
 */
function accessorOf(lookups: readonly LiquidExpression[]): Accessor {
  const first = lookups[0];
  if (!first) return 'unknown';
  if (first.type === NodeTypes.String) return 'key';
  if (first.type === NodeTypes.Number) return 'index';
  return 'unknown';
}

/**
 * Which rule the tag answers to, or `undefined` when it writes no container.
 *
 * MEASURED against `/api/app_builder/liquid_exec`, every container × subscript combination, with
 * the container read back so acceptance means the write happened. All three tags agree:
 *
 *                        x['k'] = V           x[0] = V          x.k = V
 *   Hash                 writes               writes (key "0")  writes
 *   Array                raises, wants index  writes            raises, wants index
 *   String/Number/       raises, "expected Hash or Array" for every subscript
 *   Boolean/nil/unset
 *
 * The ONE difference is notation: `hash_assign` cannot parse a dot target, or a target with no
 * subscript at all. Both are parse-time refusals whatever the container holds, so both belong to
 * `InvalidHashAssignTargetSyntax` rather than here.
 */
function containerWriteOf(node: LiquidTag): ContainerWrite | undefined {
  const write = writeTargetOf(node);
  if (!write?.name) return undefined;

  if (write.lookups.length > 0) {
    // `x['k'] << v` is NOT this rule: the runtime checks the value AT the subscript — measured,
    // "x[k] is null, expected Array" — and nothing here tracks element types.
    return write.operator === '='
      ? {
          rule: 'subscript',
          name: write.name,
          accessor: accessorOf(write.lookups),
          start: write.target.start,
          end: write.target.end,
        }
      : undefined;
  }

  // A plain `=` REPLACES the variable, so there is no container to judge.
  return write.operator === '<<'
    ? {
        rule: 'append',
        name: write.name,
        start: write.markup.start,
        end: trimmedEnd(node.source, write.markup.start, write.markup.end),
      }
    : undefined;
}

/**
 * An append highlights the whole markup, whose position runs up to the tag's `%}` and so takes
 * the whitespace before it with it. The squiggle should stop at the code.
 */
function trimmedEnd(source: string, start: number, end: number): number {
  return start + source.slice(start, end).trimEnd().length;
}

export const InvalidWriteTarget: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidWriteTarget',
    name: 'Invalid write target',
    docs: {
      description:
        "Reports a write through a subscript (assign, hash_assign, function) against a target the runtime rejects: a value that is neither a Hash nor an Array, or an Array subscripted with a string key instead of a numeric index. Also reports '<<' against a target that is not an Array.",
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * The type in effect for `name` where this tag begins — the tag's START, because that is where
     * the PREVIOUS binding is still current; this tag's own effect on the table begins at its end.
     *
     * BOTH HALVES ARE MEMOIZED UPSTREAM — the table on the `AppFile` via `derived`, the sources on
     * the docset via a `WeakMap` — so there is nothing to cache here. Reached only after
     * {@link containerWriteOf} finds a write, so a file with none builds no table at all.
     */
    const typeAt = async (name: string, node: LiquidTag): Promise<LiquidType> => {
      const [variables, sources] = await Promise.all([
        variableTypesOf(context.file),
        variableTypeSources(context.platformosDocset),
      ]);

      return variables.typeAt(name, node.position.start, sources);
    };

    return {
      async LiquidTag(node: LiquidTag) {
        const write = containerWriteOf(node);
        if (!write) return;

        const type = await typeAt(write.name, node);
        const message =
          write.rule === 'append'
            ? appendMessage(write.name, type)
            : subscriptWriteMessage(write.name, type, write.accessor);

        if (message) {
          context.report({ message, startIndex: write.start, endIndex: write.end });
        }
      },
    };
  },
};
