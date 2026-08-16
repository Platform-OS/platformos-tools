import {
  LiquidExpression,
  LiquidTag,
  LiquidVariable,
  NamedTags,
  Position,
} from '@platformos/liquid-html-parser';

/**
 * ONE answer to "what does this tag write, and where is its target".
 *
 * Three tags spell one write — `{% assign %}`, the deprecated `{% hash_assign %}` and
 * `{% function %}` — and they reach the same runtime setter. Their markups spell it three
 * different ways: `assign` keeps the name and the lookups apart, `hash_assign` publishes a
 * `target` lookup, `function` publishes a `name` lookup. Six places in this package used to
 * unpick that by hand, each with its own cast.
 *
 * WHAT THIS DOES NOT DECIDE. Two consumers read these fields and reach different conclusions,
 * because they answer different questions: `variable-types.ts` asks what the write DOES to the
 * type table (a subscript write narrows the container to a Hash; `<<` narrows it to an Array),
 * and `checks/invalid-write-target` asks whether it is LEGAL (a subscript write needs a Hash or
 * an Array; `<<` needs an Array and refuses a Hash). Those trees look alike and are not the
 * same — `x['k'] << v` narrows there and is deliberately silent here. Only the extraction is
 * shared; each consumer keeps its own rule.
 */
export interface WriteTarget {
  /** Which of the three tags spelled it — the one thing the consumers still branch on. */
  tag: NamedTags.assign | NamedTags.hash_assign | NamedTags.function;

  /** The base variable name, or `null` when the markup carries none. */
  name: string | null;

  /** The subscripts on the target. Empty means the write REPLACES the variable. */
  lookups: readonly LiquidExpression[];

  /** `=` writes, `<<` appends. */
  operator: '=' | '<<';

  /** The whole markup — up to the tag's `%}`, so it carries the trailing whitespace with it. */
  markup: Position;

  /**
   * The target alone — `x`, `x['k']`, `x.a.b`. All three tags publish this now; `assign` gained
   * `targetPosition` in the parser precisely so this one did not have to be recovered by scanning
   * the source for the closing bracket.
   */
  target: Position;

  /** The assigned expression, for the two tags whose markup publishes one. */
  value: LiquidVariable | undefined;
}

/**
 * The write a tag spells, or `undefined` when it spells none.
 *
 * The discriminant is tested BEFORE the markup is captured, which is what types each arm without
 * a cast. A raw string still reaches here — the parser is tolerant, and the declared markup types
 * do not admit one — so every arm keeps its runtime guard.
 */
export function writeTargetOf(node: LiquidTag): WriteTarget | undefined {
  switch (node.name) {
    case NamedTags.assign: {
      if (typeof node.markup === 'string') return undefined;
      const { name, lookups, operator, value, position, targetPosition } = node.markup;
      return {
        tag: NamedTags.assign,
        name,
        lookups,
        operator,
        markup: position,
        target: targetPosition,
        value,
      };
    }

    case NamedTags.hash_assign: {
      if (typeof node.markup === 'string') return undefined;
      const { target, value, position } = node.markup;
      return {
        tag: NamedTags.hash_assign,
        name: target.name,
        lookups: target.lookups ?? [],
        // `hash_assign` has no append form.
        operator: '=',
        markup: position,
        target: target.position,
        value,
      };
    }

    case NamedTags.function: {
      if (typeof node.markup === 'string') return undefined;
      const { name, operator, position } = node.markup;
      return {
        tag: NamedTags.function,
        name: name.name,
        lookups: name.lookups,
        operator,
        markup: position,
        target: name.position,
        // A `function` assigns the partial's RETURN value, which is not an expression in the
        // markup — `markup.partial` names the partial, it is not the assigned value.
        value: undefined,
      };
    }

    default:
      return undefined;
  }
}
