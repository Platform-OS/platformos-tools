import { grammars, Grammar } from 'ohm-js';

export const liquidHtmlGrammars = grammars(require('../grammar/liquid-html.ohm.js'));

export const TextNodeGrammar = liquidHtmlGrammars['Helpers'];
export const LiquidDocGrammar = liquidHtmlGrammars['LiquidDoc'];

export interface LiquidGrammars {
  Liquid: Grammar;
  LiquidHTML: Grammar;
  LiquidStatement: Grammar;
}

export const strictGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['StrictLiquid'],
  LiquidHTML: liquidHtmlGrammars['StrictLiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['StrictLiquidStatement'],
};

export const tolerantGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['Liquid'],
  LiquidHTML: liquidHtmlGrammars['LiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['LiquidStatement'],
};

export const placeholderGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['WithPlaceholderLiquid'],
  LiquidHTML: liquidHtmlGrammars['WithPlaceholderLiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['WithPlaceholderLiquidStatement'],
};

// see ../../grammar/liquid-html.ohm for full list
export const BLOCKS = (strictGrammars.LiquidHTML.rules as any).blockName.body.factors[0].terms.map(
  (x: any) => x.obj,
) as string[];

// see ../../grammar/liquid-html.ohm for full list
export const RAW_TAGS = (() => {
  const rule = (strictGrammars.LiquidHTML.rules as any).liquidRawTag;
  // When there's only one alternative, body is the Apply node directly (no .terms)
  const terms = rule.body.terms ? rule.body.terms : [rule.body];
  return terms.map((term: any) => term.args[0].obj).concat('comment') as string[];
})();

// see ../../grammar/liquid-html.ohm for full list
export const VOID_ELEMENTS = (
  strictGrammars.LiquidHTML.rules as any
).voidElementName.body.factors[0].terms.map((x: any) => x.args[0].obj) as string[];

/**
 * The two rule templates a named tag is declared through, e.g.
 * `liquidTagRollback = liquidTagRule<"rollback", empty>`.
 */
const NAMED_TAG_RULE_TEMPLATES = new Set(['liquidTagRule', 'liquidTagOpenRule']);

/**
 * Tag names the GRAMMAR itself declares as taking no markup — those whose markup argument is
 * `empty`.
 *
 * DERIVED rather than hand-listed, because the hand-listed version drifted and the drift was
 * unappealable: `{% rollback %}` was missing from it, so `InvalidTagSyntax` refused every
 * spelling of a valid tag with the self-refuting message "Invalid syntax for tag 'rollback'
 * Expected syntax: rollback", and `LiquidHTMLSyntaxError` blocks. Deriving it covers the next
 * `liquidTagRule<"x", empty>` the moment it is written.
 *
 * TWO IMPLEMENTATION TRAPS, both hit while writing this:
 *
 *   `for..in`, NOT `Object.keys`. Ohm chains grammars through the prototype, so
 *   `StrictLiquidHTML.rules` has only TWO own keys and inherits the rest — `Object.keys`
 *   returned a plausible, silent, empty answer, which is why the spec pins the expected names.
 *
 *   Duck typing, NOT `constructor.name`. An Ohm `Apply` carries `ruleName` and a `Terminal`
 *   carries `obj`; `constructor.name` would be mangled by minification in the webpack-bundled
 *   VS Code extension.
 *
 * ONE KNOWN CONSEQUENCE, accepted deliberately. `markup()` in stage 2 returns `''` for every tag
 * on this list, so stray text after the tag name is dropped and the printer reformats
 * `{% rollback something %}` to `{% rollback %}`. The stray text is provably inert — measured,
 * the platform IGNORES it — so nothing the platform reads is lost, and `break`, `continue` and
 * `else` have always behaved this way.
 */
const EMPTY_MARKUP_TAGS = (() => {
  const rules = strictGrammars.LiquidHTML.rules as Record<string, any>;
  const names = new Set<string>();

  for (const ruleName in rules) {
    const body = rules[ruleName]?.body;
    if (!body || !NAMED_TAG_RULE_TEMPLATES.has(body.ruleName)) continue;

    const args = body.args;
    if (args?.length !== 2) continue;
    if (args[1]?.ruleName === 'empty' && typeof args[0]?.obj === 'string') names.add(args[0].obj);
  }

  return [...names];
})();

/**
 * Tags whose BODY is raw content and whose opening tag takes no markup.
 *
 * Kept explicit rather than derived, because these are declared through their own grammar
 * rules — `liquidRawTag` and `liquidDoc` — not through `liquidTagRule`, so no single
 * derivation covers both groups. Deliberately NOT spliced from `RAW_TAGS` either: that would
 * couple a list gating a BLOCKING check to a list maintained for a different purpose, so a
 * change there would silently change what this exempts.
 */
const RAW_CONTENT_TAGS = ['comment', 'raw', 'doc'];

/**
 * Tags for which an empty markup string is CORRECT rather than a parse failure.
 *
 * `InvalidTagSyntax` treats "the markup came back as a string" as the tolerant parser's signal
 * that a known tag's strict markup rule failed, so a tag that legitimately has no markup has
 * to be exempt here or every use of it is a false block.
 */
export const TAGS_WITHOUT_MARKUP = [...EMPTY_MARKUP_TAGS, ...RAW_CONTENT_TAGS];
