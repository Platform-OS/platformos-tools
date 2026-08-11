import { LiquidExpression, LiquidFilter, NodeTypes } from '@platformos/liquid-html-parser';

/**
 * What a filter does to the value flowing through it, for the two analyses that follow a
 * value across a filter chain. Anything absent transforms, and describes a value neither
 * analysis knows.
 *
 * Hand-written, and deliberately NOT derived from the generated `filter-arity.ts`: that
 * file is regenerated against a live instance and may drop a name it can no longer
 * determine, which for an arity is a missing bound and here would be a wrong answer.
 */
type FilterValueSemantics =
  /** Returns a value already inside its input, at the path its arguments name. */
  | { kind: 'navigates'; maxKeys: number }
  /** Returns one of two operands — the piped value, or the argument standing in for it. */
  | { kind: 'alternative' };

/** `dig` and `fetch` are aliases of `hash_dig` and `hash_fetch`. */
const SEMANTICS_BY_FILTER = new Map<string, FilterValueSemantics>([
  ['dig', { kind: 'navigates', maxKeys: Infinity }],
  ['hash_dig', { kind: 'navigates', maxKeys: Infinity }],
  ['fetch', { kind: 'navigates', maxKeys: 1 }],
  ['hash_fetch', { kind: 'navigates', maxKeys: 1 }],
  ['default', { kind: 'alternative' }],
]);

export function navigationFilter(name: string): { maxKeys: number } | undefined {
  const semantics = SEMANTICS_BY_FILTER.get(name);
  return semantics?.kind === 'navigates' ? semantics : undefined;
}

export function isAlternativeReturningFilter(name: string): boolean {
  return SEMANTICS_BY_FILTER.get(name)?.kind === 'alternative';
}

/**
 * WHICH ARGUMENT stands in for the piped value, for an `alternative`-kind filter.
 *
 * Part of the same fact as the `alternative` row itself, and out here for the same reason:
 * both analyses that follow a value across a filter chain need it, and each had derived it
 * privately — one in this package, one in the language server.
 *
 * It is the first POSITIONAL argument. `{{ x | default }}` names no substitute, and neither
 * does `{{ x | default: allow_false: true }}`: a `NamedArgument` is an option to the filter,
 * never the value it falls back to. Callers narrow further — an analysis that has to READ the
 * substitute wants a literal, not merely an expression.
 */
export function alternativeSubstituteArg(filter: LiquidFilter): LiquidExpression | undefined {
  if (!isAlternativeReturningFilter(filter.name)) return undefined;

  const first = filter.args[0];
  return first && first.type !== NodeTypes.NamedArgument ? first : undefined;
}
