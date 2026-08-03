import { LiquidHtmlNode, NodeTypes } from '@platformos/liquid-html-parser';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * A filter the platform parses but never applies.
 *
 * WHAT IS MEASURED, and why this is not derivable from the grammar. `pos-cli deploy
 * --dry-run` ACCEPTS a filter in a platformOS tag's operand or argument value, so refusing
 * one is an unappealable false block on a file that deploys. But the runtime never applies
 * it. Ruby Liquid parses those markups with its own scanner — `TagAttributes` captures
 * `QuotedFragment`, which explicitly excludes `|` — so the filter is not part of the value
 * the tag receives. It is DEAD CODE, and silence would let an author ship a file that does
 * something other than what it says.
 *
 * Measured against `/api/app_builder/liquid_exec`, 15 positions, three independent lenses,
 * each paired with a filterless control that renders clean:
 *
 *   {{ 'a' | no_such_filter_xyz }}                        RAISES UndefinedFilter  <- control
 *   {% assign x = 'a' | no_such_filter_xyz %}             RAISES                  <- control
 *   {{ 'a' | upcase: 1, 2, 3 }}                           RAISES ArgumentError    <- control
 *   {% cache 'k' | no_such_filter_xyz %}x{% endcache %}   renders clean
 *   {% log 'm', type: 't' | no_such_filter_xyz %}         renders clean
 *   {% case 'a' | upcase %}{% when 'A' %}…{% when 'a' %}  matches 'a'             <- decisive
 *
 * The `case` row is the strongest evidence obtainable: the filter's effect on control flow
 * is directly observable, and the UNFILTERED branch wins.
 *
 * WHY AN ALLOWLIST OF APPLYING POSITIONS, rather than a list of ignoring ones. The set where
 * filters genuinely apply is core Liquid — `{{ }}`, `assign`, `echo`/`print`, `return`,
 * `session` — and is stable. The set that ignores them grows every time platformOS adds a
 * tag. Listing the stable set means a NEW tag is reported by default, which is the direction
 * that ages well.
 *
 * The cost of that choice, stated rather than discovered later: a future position where
 * filters DO apply would be warned about until it is added below. That is a non-blocking
 * warning on working code — visible and cheap — whereas the inverse silently misses every
 * new tag. This check must never join `BLOCKING_CHECKS`: the file deploys and renders.
 *
 * NOT IN SCOPE. A markup-level trailing filter list is a different AST shape — it hangs off
 * the markup node (`FunctionMarkup.filters`, `GraphQLMarkup.filters`), not off a
 * `LiquidVariable` — so it is never visited here. That is correct: `{% return 'a' | upcase %}`
 * has the same shape and was measured to APPLY, and `{% function r = 'p', a: 1 | dig: 'x' %}`
 * filters the function's RESULT.
 */

/**
 * Positions where the platform parses the value as a full Liquid variable, so filters apply.
 *
 * Keyed by the parent node type and the field holding the variable, because neither alone is
 * enough: `LiquidTag.markup` holds an APPLYING variable for `echo` and an IGNORED one for
 * `case` and `yield`, which is why a purely structural "is it the whole markup" test was
 * measured and rejected.
 */
const APPLIES_BY_PARENT_FIELD: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [NodeTypes.LiquidVariableOutput, new Set(['markup'])],
  [NodeTypes.AssignMarkup, new Set(['value'])],
  [NodeTypes.SessionMarkup, new Set(['value'])],
]);

/** Tags whose ENTIRE markup is a Liquid variable, so filters apply. */
const APPLIES_AS_WHOLE_TAG_MARKUP: ReadonlySet<string> = new Set(['echo', 'print', 'return']);

/** Which field of `parent` holds `node`, or undefined when it is not a direct child. */
function fieldHolding(parent: LiquidHtmlNode, node: LiquidHtmlNode): string | undefined {
  for (const [key, value] of Object.entries(parent)) {
    if (value === node) return key;
    if (Array.isArray(value) && value.includes(node)) return key;
  }
  return undefined;
}

function filtersApplyHere(parent: LiquidHtmlNode, node: LiquidHtmlNode): boolean {
  const field = fieldHolding(parent, node);
  if (field === undefined) return false;

  if (parent.type === NodeTypes.LiquidTag) {
    return field === 'markup' && APPLIES_AS_WHOLE_TAG_MARKUP.has(String(parent.name));
  }

  return APPLIES_BY_PARENT_FIELD.get(parent.type)?.has(field) ?? false;
}

export const FilterWithoutEffect: LiquidCheckDefinition = {
  meta: {
    code: 'FilterWithoutEffect',
    name: 'Filter in a position the platform ignores',
    docs: {
      description:
        'Reports a filter applied in a platformOS tag operand or argument value. The deploy converter accepts it, but the runtime parses those markups with its own scanner and never applies the filter, so the value is used unfiltered.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidVariable(node, ancestors) {
        if (node.filters.length === 0) return;

        const parent = ancestors[ancestors.length - 1];
        if (!parent || filtersApplyHere(parent, node)) return;

        const names = node.filters.map((filter) => `'${filter.name}'`).join(', ');
        const [first] = node.filters;

        context.report({
          message:
            `${node.filters.length === 1 ? `Filter ${names} has` : `Filters ${names} have`} no effect here. ` +
            'platformOS parses this tag markup with its own scanner and never applies the filter, ' +
            'so the unfiltered value is used. Apply it in an {% assign %} first and pass the ' +
            'assigned variable.',
          // The FILTERS are highlighted, not the whole expression: the value is fine and the
          // filter is the dead part, so underlining the value would suggest changing it.
          // A LiquidFilter's own range opens at the whitespace before its `|` — measured,
          // not assumed — so the highlight starts one character left of the pipe.
          startIndex: first.position.start,
          endIndex: node.filters[node.filters.length - 1].position.end,
        });
      },
    };
  },
};
