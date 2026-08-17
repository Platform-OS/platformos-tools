import { expect, it, describe } from 'vitest';
import {
  BLOCKS,
  placeholderGrammars,
  strictGrammars,
  tolerantGrammars,
  TAGS_WITHOUT_MARKUP,
} from './grammar';

/**
 * `TAGS_WITHOUT_MARKUP` is derived from the grammar rather than hand-listed, and this
 * pins the derivation.
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
 * `BLOCKS` is derived from the grammar's `blockName` rule, and `UnknownTag` builds
 * its known-tag vocabulary from it — so a name missing here is reported as an unknown tag,
 * which `LiquidHTMLSyntaxError` raises at ERROR severity and the MCP supervisor BLOCKS.
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
        expectMatchSucceeded('<a src="https://item"></a>').to.be.true;
        expectMatchSucceeded('<a src="https://google.com"></b>').to.be.true;
        expectMatchSucceeded(`<img src="hello" loading='lazy' enabled=true disabled>`).to.be.true;
        expectMatchSucceeded(`<img src="hello" loading='lazy' enabled=true disabled />`).to.be.true;
        expectMatchSucceeded(`<{{header_type}}-header>`).to.be.true;
        expectMatchSucceeded(`<header--{{header_type}}>`).to.be.true;
        expectMatchSucceeded(`<-nope>`).to.be.false;
        expectMatchSucceeded(`<:nope>`).to.be.false;
        expectMatchSucceeded(`<1nope>`).to.be.false;
        expectMatchSucceeded(`{{ item.feature }}`).to.be.true;
        expectMatchSucceeded(`{{item.feature}}`).to.be.true;
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
        expectMatchSucceeded(`{% render "item", %}`).to.be.true;
        expectMatchSucceeded(`{% render "item", item: item, %}`).to.be.true;
        expectMatchSucceeded(`{% render "item" with foo as bar, %}`).to.be.true;
        expectMatchSucceeded(`{% echo "item" | split: '', %}`).to.be.true;
        expectMatchSucceeded(`{{ "item" | split: '', }}`).to.be.true;
        expectMatchSucceeded(`{% function _res="item" %}`).to.be.true;
        expectMatchSucceeded(`{% function res = "item", hello: "world" %}`).to.be.true;
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
     * `{% layout %}` is not a platformOS tag — measured against both `pos-cli deploy --dry-run`
     * and `liquid_exec`, which answer `Unknown tag 'layout'`, and a converter rejection fails
     * the WHOLE changeset. platformOS selects a layout from FRONTMATTER (`layout: application`).
     * So the grammar must treat the name exactly as it treats any it has never heard of — no
     * better and no worse — or the parser approves a file the platform rejects.
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
          if context.language contains "{{ abc }}"
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
