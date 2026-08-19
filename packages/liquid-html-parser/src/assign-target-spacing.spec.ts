import { describe, expect, it } from 'vitest';
import { toLiquidHtmlAST, toLiquidAST, walk } from './stage-2-ast';
import type { LiquidTag, LiquidHtmlNode } from './stage-2-ast';
import { NodeTypes } from './types';

/**
 * platformOS refuses whitespace between a variable and the start of its key path in a WRITE TARGET,
 * and accepts it wherever a value is READ. Both halves are measured against
 * `/api/app_builder/liquid_exec` and `pos-cli deploy --dry-run`; the rule being mirrored is
 * `LHS_PATTERN` in the platform's `app/lib/liquify/tags/hash_assignable.rb`.
 *
 * Getting only the first half right trades one false approval for six false blocks, so the read
 * cases below are load-bearing rather than decorative.
 */

const WRITE_TAGS = ['assign', 'hash_assign', 'function'] as const;

/**
 * The parser is TOLERANT: a markup rule that fails does not throw, it stores the markup as a raw
 * string for a check to report. "Did the grammar accept this?" is therefore `typeof markup`, never
 * the absence of an exception.
 */
function targetIsStructured(source: string): boolean {
  let structured: boolean | undefined;
  walk(toLiquidHtmlAST(source), (node: LiquidHtmlNode) => {
    if (node.type !== NodeTypes.LiquidTag) return;
    if (!(WRITE_TAGS as readonly string[]).includes((node as LiquidTag).name)) return;
    structured = typeof (node as LiquidTag).markup !== 'string';
  });
  if (structured === undefined) throw new Error(`no write tag found in: ${source}`);
  return structured;
}

/** Every statement is exercised as a tag and again inside a `{% liquid %}` body. */
const asTag = (statement: string) => `{% ${statement} %}`;
const inLiquidBlock = (statement: string) => `{% liquid\n  ${statement}\n%}`;

const REFUSED = [
  `assign h ['k'] = 9`,
  `assign h .k = 9`,
  `assign h . k = 9`,
  `assign h\t['k'] = 9`,
  `assign a ['z'] << 'x'`,
  `assign h ['a']['b'] = 9`,
  `assign h['a'] .b = 9`,
  `assign h.a .b = 9`,
  `hash_assign h ['k'] = 9`,
  `hash_assign h .k = 9`,
  `function r ['k'] = 'lib/x'`,
  `function r .k = 'lib/x'`,
  `function r ['k'] << 'lib/x'`,
];

const ACCEPTED = [
  `assign x = 9`,
  `assign x  =  9`,
  `assign h['k'] = 9`,
  `assign h.k = 9`,
  `assign h[ 'k' ] = 9`,
  `assign h['k' ] = 9`,
  `assign h[ 'k'] = 9`,
  `assign h["k"] = 9`,
  `assign h[0] = 9`,
  `assign h[k] = 9`,
  `assign h['a']['b'] = 9`,
  `assign h.a.b = 9`,
  `assign h['a'].b = 9`,
  `assign h['a'] ['b'] = 9`,
  `assign h['a']  ['b'] = 9`,
  `assign a << 'x'`,
  `assign a['z'] << 'x'`,
  `hash_assign h['k'] = 9`,
  `hash_assign h['a']['b'] = 9`,
  `function r = 'lib/x'`,
  `function r['k'] = 'lib/x'`,
  `function r << 'lib/x'`,
];

/**
 * Read positions. Each renders the CORRECT value on the platform, so narrowing the shared `lookup`
 * rule instead of adding a target-only one would turn working code into errors.
 */
const READS = [
  `{{ h ['k'] }}`,
  `{{ h .k }}`,
  `{{ h.a [0] }}`,
  `{{ h[ 'k' ] }}`,
  `{% assign v = h ['k'] %}`,
  `{% hash_assign h['k'] = g ['j'] %}`,
  `{% if h ['k'] %}x{% endif %}`,
  `{% unless h ['k'] %}x{% endunless %}`,
  `{% echo h ['k'] %}`,
  `{% for i in h ['a'] %}x{% endfor %}`,
  `{{ 'a' | append: h ['k'] }}`,
  `{% render 'p', v: h ['k'] %}`,
  `{{ ['a'] }}`,
];

describe('Unit: assign target spacing', () => {
  describe('a space between the variable and its key path is refused', () => {
    it.each(REFUSED)('%s', (statement) => {
      expect(targetIsStructured(asTag(statement))).toBe(false);
    });

    it.each(REFUSED)('%s — inside a {%% liquid %%} body', (statement) => {
      expect(targetIsStructured(inLiquidBlock(statement))).toBe(false);
    });

    it('a newline before the key path is refused too', () => {
      expect(targetIsStructured(`{% assign h\n['k'] = 9 %}`)).toBe(false);
    });

    /**
     * KNOWN GAP, pinned so it is visible rather than assumed covered. The platform refuses a spaced
     * bracket that follows a DOT — its `\[.+?\]` can backtrack across a space only from another
     * bracket — but expressing "spaced bracket only after a bracket" needs a recursive chain, which
     * would replace the flat `lookups` iteration the stage-1 mapping indexes. Left accepting: this
     * is the pre-existing behaviour and a residual false approval, where narrowing it wrongly would
     * be a false block.
     */
    it('still accepts a spaced bracket after a dot, which the platform refuses', () => {
      expect(targetIsStructured(`{% assign h.a ['b'] = 9 %}`)).toBe(true);
    });
  });

  describe('the spellings the platform accepts still parse', () => {
    it.each(ACCEPTED)('%s', (statement) => {
      expect(targetIsStructured(asTag(statement))).toBe(true);
    });

    it.each(ACCEPTED)('%s — inside a {%% liquid %%} body', (statement) => {
      expect(targetIsStructured(inLiquidBlock(statement))).toBe(true);
    });
  });

  describe('read positions keep accepting the space', () => {
    it.each(READS)('%s', (source) => {
      expect(() => toLiquidHtmlAST(source)).not.toThrow();
    });

    it('resolves a spaced read as a lookup rather than dropping the key', () => {
      const ast: any = toLiquidHtmlAST(`{{ h ['k'] }}`);
      const output = ast.children.find(
        (child: any) => child.type === NodeTypes.LiquidVariableOutput,
      );
      expect(output.markup.expression.name).toBe('h');
      expect(output.markup.expression.lookups).toHaveLength(1);
    });
  });

  it('reaches the same verdict through toLiquidAST', () => {
    const markupOf = (source: string) => {
      let markup: unknown;
      walk(toLiquidAST(source) as LiquidHtmlNode, (node: LiquidHtmlNode) => {
        if (node.type === NodeTypes.LiquidTag && (node as LiquidTag).name === 'assign') {
          markup = (node as LiquidTag).markup;
        }
      });
      return markup;
    };
    expect(typeof markupOf(`{% assign h ['k'] = 9 %}`)).toBe('string');
    expect(typeof markupOf(`{% assign h['k'] = 9 %}`)).not.toBe('string');
  });
});
