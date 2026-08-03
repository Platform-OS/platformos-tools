import { expect, it, describe } from 'vitest';
import {
  BLOCKS,
  placeholderGrammars,
  strictGrammars,
  tolerantGrammars,
  TAGS_WITHOUT_MARKUP,
} from './grammar';

/**
 * TASK-48. `TAGS_WITHOUT_MARKUP` is derived from the grammar rather than hand-listed, and this
 * pins the derivation.
 *
 * WHY PINNED BY NAME rather than "the list is non-empty". The first attempt at the derivation
 * used `Object.keys(rules)` and returned an EMPTY list — Ohm chains grammars through the
 * prototype, so `StrictLiquidHTML.rules` has only two own keys and inherits the rest. An empty
 * list is silently catastrophic here: `InvalidTagSyntax` would refuse `{% else %}`,
 * `{% break %}`, `{% continue %}` and `{% try %}` on every use, and `UnknownTag` builds its
 * known-tag vocabulary from this same list. A test asserting only "not empty" would have
 * caught that; one asserting the exact names also catches a derivation that grows or shrinks
 * for the wrong reason.
 */
describe('Unit: TAGS_WITHOUT_MARKUP', () => {
  it('derives exactly the tags the grammar declares as taking no markup', () => {
    // `rollback` is the name that was missing while this list was maintained by hand — every
    // spelling of `{% rollback %}` was refused by a BLOCKING check on a tag the platform
    // parses fine. The four alongside it were already exempt, which is what localised the
    // defect to the list rather than to the fallback logic.
    expect([...TAGS_WITHOUT_MARKUP].sort()).toEqual([
      'break',
      'comment',
      'continue',
      'doc',
      'else',
      'raw',
      'rollback',
      'try',
    ]);
  });

  it('agrees across all three grammar modes, so no mode carries a different vocabulary', () => {
    // The derivation reads `strictGrammars`. The tolerant and placeholder grammars override
    // other rules, and a divergence here would mean a tag exempt in one mode and refused in
    // another — the sort of thing that shows up only in the editor, or only on deploy.
    const emptyMarkupTagsOf = (grammar: { rules: unknown }) => {
      const rules = grammar.rules as Record<string, any>;
      const names = new Set<string>();
      for (const ruleName in rules) {
        const body = rules[ruleName]?.body;
        if (!body || !['liquidTagRule', 'liquidTagOpenRule'].includes(body.ruleName)) continue;
        const args = body.args;
        if (args?.length !== 2) continue;
        if (args[1]?.ruleName === 'empty' && typeof args[0]?.obj === 'string')
          names.add(args[0].obj);
      }
      return [...names].sort();
    };

    const expected = ['break', 'continue', 'else', 'rollback', 'try'];
    expect(emptyMarkupTagsOf(strictGrammars.LiquidHTML)).toEqual(expected);
    expect(emptyMarkupTagsOf(tolerantGrammars.LiquidHTML)).toEqual(expected);
    expect(emptyMarkupTagsOf(placeholderGrammars.LiquidHTML)).toEqual(expected);
  });

  it('is not vacuous: a tag that DOES take markup is absent', () => {
    // The control. A derivation matching every `liquidTagRule` regardless of its markup
    // argument would satisfy the assertions above by containing them, and would then exempt
    // every tag in the language from `InvalidTagSyntax`.
    for (const takesMarkup of ['assign', 'render', 'if', 'for', 'cache', 'log']) {
      expect(TAGS_WITHOUT_MARKUP).not.toContain(takesMarkup);
    }
  });
});

/**
 * TASK-56. `BLOCKS` is derived from the grammar's `blockName` rule, and `UnknownTag` builds
 * its known-tag vocabulary from it — so a name missing here is reported as an unknown tag,
 * which `LiquidHTMLSyntaxError` raises at ERROR severity and the MCP supervisor BLOCKS.
 *
 * Nothing pinned this list before, which is how `try_rc` went missing: the platform
 * registers it against the same handler as `try`, and both `{% try_rc %}` and its close tag
 * were refused. The same derivation shape as `TAGS_WITHOUT_MARKUP` above, and the same
 * failure mode — it reads Ohm's rule internals, so it can quietly return the wrong thing.
 */
describe('Unit: BLOCKS', () => {
  it('derives exactly the block tag names the grammar declares', () => {
    expect([...BLOCKS].sort()).toEqual([
      'background',
      'cache',
      'capture',
      'case',
      'content_for',
      'for',
      'form',
      'graphql',
      'if',
      'ifchanged',
      'parse_json',
      'tablerow',
      'transaction',
      'try',
      'try_rc',
      'unless',
    ]);
  });

  it('lists try_rc BEFORE try, because `blockName` is an ordered choice', () => {
    // Not cosmetic, and not assertable from the parse of a WELL-FORMED document — both
    // orderings accept `{% try_rc %}…{% endtry_rc %}` in the tolerant grammar, so no
    // fixture distinguishes them. What the wrong order breaks is the STRICT grammar, where
    // `try` matches first and then fails on the leftover `_rc`.
    //
    // Asserted directly for exactly that reason: when precedence between two alternatives
    // cannot be distinguished by real input, the ordering itself is the contract.
    //
    // Membership is asserted first because `indexOf` returns -1 for an absent name, and -1
    // is less than every real index — so the ordering check alone would PASS if `try_rc`
    // were removed entirely, which is the very regression this file exists to catch.
    expect(BLOCKS).toContain('try_rc');
    expect(BLOCKS).toContain('try');
    expect(BLOCKS.indexOf('try_rc')).toBeLessThan(BLOCKS.indexOf('try'));
  });

  it('is not vacuous: a non-block tag is absent', () => {
    // The control. A derivation that swept up every quoted name in the grammar would
    // satisfy the assertion above by containing it, and would then let `{% endassign %}`
    // through as a legitimate close tag.
    for (const notABlock of ['assign', 'echo', 'render', 'log', 'return', 'context']) {
      expect(BLOCKS).not.toContain(notABlock);
    }
  });
});

describe('Unit: liquidHtmlGrammar', () => {
  const grammars = [
    { mode: 'strict', grammar: strictGrammars },
    { mode: 'tolerant', grammar: tolerantGrammars },
    { mode: 'completion', grammar: placeholderGrammars },
  ];

  describe(`Case: common to all grammars`, () => {
    it('should parse or not parse HTML+Liquid', () => {
      grammars.forEach(({ grammar }) => {
        expectMatchSucceeded('<h6 data-src="hello world">').to.be.true;
        expectMatchSucceeded('<a src="https://product"></a>').to.be.true;
        expectMatchSucceeded('<a src="https://google.com"></b>').to.be.true;
        expectMatchSucceeded(`<img src="hello" loading='lazy' enabled=true disabled>`).to.be.true;
        expectMatchSucceeded(`<img src="hello" loading='lazy' enabled=true disabled />`).to.be.true;
        expectMatchSucceeded(`<{{header_type}}-header>`).to.be.true;
        expectMatchSucceeded(`<header--{{header_type}}>`).to.be.true;
        expectMatchSucceeded(`<-nope>`).to.be.false;
        expectMatchSucceeded(`<:nope>`).to.be.false;
        expectMatchSucceeded(`<1nope>`).to.be.false;
        expectMatchSucceeded(`{{ product.feature }}`).to.be.true;
        expectMatchSucceeded(`{{product.feature}}`).to.be.true;
        expectMatchSucceeded(`{%- if A -%}`).to.be.true;
        expectMatchSucceeded(`{%-if A-%}`).to.be.true;
        expectMatchSucceeded(`{%- else-%}`).to.be.true;
        expectMatchSucceeded(`{%- break-%}`).to.be.true;
        expectMatchSucceeded(`{%- continue -%}`).to.be.true;
        expectMatchSucceeded(`{%- liquid-%}`).to.be.true;
        expectMatchSucceeded(`{%- form 'form-type'-%}`).to.be.true;
        expectMatchSucceeded(`{%- # a comment -%}`).to.be.true;
        expectMatchSucceeded(`{%- include 'layout' -%}`).to.be.true;
        expectMatchSucceeded(`{% render 'filename' for array as item %}`).to.be.true;
        expectMatchSucceeded(`{% assign variable_name = value %}`).to.be.true;
        expectMatchSucceeded(`{% render "product", %}`).to.be.true;
        expectMatchSucceeded(`{% render "product", product: product, %}`).to.be.true;
        expectMatchSucceeded(`{% render "product" with foo as bar, %}`).to.be.true;
        expectMatchSucceeded(`{% echo "product" | split: '', %}`).to.be.true;
        expectMatchSucceeded(`{{ "product" | split: '', }}`).to.be.true;
        expectMatchSucceeded(`{% function _res="product" %}`).to.be.true;
        expectMatchSucceeded(`{% function res = "product", hello: "world" %}`).to.be.true;
        expectMatchSucceeded(`{% graphql res="graphql" %}`).to.be.true;
        expectMatchSucceeded(`{% graphql res="graphql", param: "test" %}`).to.be.true;
        expectMatchSucceeded(`
          {% capture variable %}
            value
          {% endcapture %}
        `).to.be.true;
        expectMatchSucceeded(`
          {% for variable in array limit: number %}
            expression
          {% endfor %}
        `).to.be.true;

        expectMatchSucceeded(`{% decrement variable_name %}`).to.be.true;
        expectMatchSucceeded(`{% increment variable_name %}`).to.be.true;
        expectMatchSucceeded(`{{ true-}}`).to.be.true;
        expectMatchSucceeded(`
          <html>
            <head>
              {{ 'foo' | script_tag }}
            </head>
            <body>
              {% if true %}
                <div>
                  hello world
                </div>
              {% else %}
                nope
              {% endif %}
            </body>
          </html>
        `).to.be.true;
        expectMatchSucceeded(`
          <input
            class="[[ cssClasses.checkbox ]] form-checkbox sm:text-[8px]"
            type="checkbox"

            [[# isRefined ]]
              checked
            [[/ isRefined ]]
          />
        `).to.be.true;
        expectMatchSucceeded(`
          <svg>
              <svg a=1><svg b=2>
                <path d="M12"></path>
              </svg></svg>
          </svg>
        `).to.be.true;
        expectMatchSucceeded(`<div data-popup-{{ section.id }}="size-{{ section.id }}">`).to.be
          .true;
        expectMatchSucceeded('<img {% if aboveFold %} loading="lazy"{% endif %} />').to.be.true;
        expectMatchSucceeded('<svg><use></svg>').to.be.true;
        expectMatchSucceeded('<6h>').to.be.false;

        function expectMatchSucceeded(text: string) {
          const match = grammar.LiquidHTML.match(text, 'Node');
          return expect(match.succeeded(), text);
        }
      });
    });

    /**
     * TASK-44. `{% layout %}` is not a platformOS tag, so the grammar must treat it exactly as
     * it treats any name it has never heard of — no better and no worse.
     *
     * Two assertions that used to live in the list above claimed `{%- layout 'full-width' -%}`
     * and `{%- layout none -%}` parse. They did, via a DEDICATED rule, and that encoded a
     * deploy-wide FALSE APPROVAL: the parser accepted a file the converter rejects with
     * `Unknown tag 'layout'` — failing the WHOLE changeset — and no check objected. Measured
     * against both `--dry-run` and `liquid_exec`; platformOS selects a layout from FRONTMATTER
     * (`layout: application`), never from a tag.
     *
     * Asserted as an EQUIVALENCE against a control name rather than as a fixed expectation per
     * mode. The modes genuinely differ — the strict grammar has no base case, so an unknown tag
     * fails to match there while the tolerant and placeholder grammars accept it and let
     * `UnknownTag` report it — and pinning those three booleans by hand would just re-encode
     * today's behaviour. What matters is that `layout` is not special, which is what a control
     * can say and a literal cannot.
     */
    it('treats {% layout %} exactly like a tag it has never heard of', () => {
      const CONTROL = 'no_such_tag_zzz';

      for (const { mode, grammar } of grammars) {
        for (const shape of [`{%- NAME 'x' -%}`, `{% NAME 'x' %}`, `{%- NAME none -%}`]) {
          const layout = grammar.LiquidHTML.match(shape.replace('NAME', 'layout'), 'Node');
          const unknown = grammar.LiquidHTML.match(shape.replace('NAME', CONTROL), 'Node');

          expect(layout.succeeded(), `${mode}: ${shape}`).to.equal(unknown.succeeded());
        }
      }
    });

    it('should parse or not parse {% liquid %} lines', () => {
      grammars.forEach(({ grammar }) => {
        expectMatchSucceeded(`
          if shop.money.format contains "{{ abc }}"
            echo "hi"
          endif
        `).to.be.true;

        function expectMatchSucceeded(text: string) {
          const match = grammar.LiquidStatement.match(text.trimStart(), 'Node');
          return expect(match.succeeded(), text);
        }
      });
    });
  });

  describe('Case: placeholderGrammars', () => {
    it('should parse special placeholder characters', () => {
      expectMatchSucceeded('{% █ %}').to.be.true;
      expectMatchSucceeded('{{ █ }}').to.be.true;
      expectMatchSucceeded('{{ var.█ }}').to.be.true;
      expectMatchSucceeded('{{ var[█] }}').to.be.true;
      expectMatchSucceeded('{% echo █ %}').to.be.true;
      expectMatchSucceeded('{% echo var.█ %}').to.be.true;
      expectMatchSucceeded('{% echo var[█] %}').to.be.true;
      expectMatchSucceeded('{% echo var | █ %}').to.be.true;
      expectMatchSucceeded('{% echo var | replace: █ %}').to.be.true;
      expectMatchSucceeded('{% echo var | replace: "foo", █ %}').to.be.true;
      expectMatchSucceeded('{% echo var | replace: "foo", var: █ %}').to.be.true;
      expectMatchSucceeded('<█>').to.be.true;
      expectMatchSucceeded('<a█>').to.be.true;
      expectMatchSucceeded('</█>').to.be.true;
      expectMatchSucceeded('</a█>').to.be.true;
    });

    function expectMatchSucceeded(text: string) {
      const match = placeholderGrammars.LiquidHTML.match(text.trimStart(), 'Node');
      return expect(match.succeeded(), text);
    }
  });
});
