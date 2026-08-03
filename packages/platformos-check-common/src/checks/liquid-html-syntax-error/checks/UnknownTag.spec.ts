import { describe, it, expect } from 'vitest';
import { runLiquidCheck, highlightedOffenses } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

describe('Module: UnknownTag', () => {
  describe('standalone unknown tags', () => {
    it('should report an unknown inline tag', async () => {
      const sourceCode = `{% dsjkds %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(1);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'dsjkds'");
    });

    it('should report an unknown tag with markup', async () => {
      const sourceCode = `{% foobar some_arg %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(1);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'foobar'");
    });

    it('should highlight the entire unknown tag', async () => {
      const sourceCode = `Hello {% unknown_tag %} world`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      const highlights = highlightedOffenses(sourceCode, unknownTagOffenses);
      expect(highlights).toContain('{% unknown_tag %}');
    });

    it('should report multiple unknown tags', async () => {
      const sourceCode = `{% foo %} {% bar %} {% baz %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(3);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'foo'");
      expect(unknownTagOffenses[1].message).toBe("Unknown tag 'bar'");
      expect(unknownTagOffenses[2].message).toBe("Unknown tag 'baz'");
    });
  });

  describe('unknown tags inside {% liquid %} blocks', () => {
    it('should report an unknown tag inside a liquid block', async () => {
      const sourceCode = `{% liquid
  assign x = "abc"
  dasjkdjkas
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(1);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'dasjkdjkas'");
    });

    it('should report multiple unknown tags inside a liquid block', async () => {
      const sourceCode = `{% liquid
  assign x = "abc"
  foo
  echo x
  bar
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(2);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'foo'");
      expect(unknownTagOffenses[1].message).toBe("Unknown tag 'bar'");
    });

    it('should not report valid tags inside a liquid block', async () => {
      const sourceCode = `{% liquid
  assign x = "hello"
  echo x
  assign y = x | upcase
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });
  });

  describe('should NOT report known tags', () => {
    it('should not report standard liquid tags', async () => {
      const validTags = [
        `{% assign x = "hello" %}`,
        `{% echo "hello" %}`,
        `{% increment counter %}`,
        `{% decrement counter %}`,
        `{% cycle "a", "b", "c" %}`,
        `{% break %}`,
        `{% continue %}`,
        // `{% layout %}` was here, and it encoded the TASK-44 false approval: this list asserts
        // that a tag is NOT reported, so including a tag the platform rejects made the defect
        // a requirement. It is now covered by the `{% layout %}` describe block below, which
        // asserts the opposite.
        `{% render 'partial' %}`,
        `{% include 'partial' %}`,
      ];

      for (const sourceCode of validTags) {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
        expect(
          unknownTagOffenses,
          `Expected no unknown tag offense for: ${sourceCode}`,
        ).toHaveLength(0);
      }
    });

    it('should not report block tags', async () => {
      const validBlocks = [
        `{% if true %}hello{% endif %}`,
        `{% unless false %}hello{% endunless %}`,
        `{% for item in array %}{{ item }}{% endfor %}`,
        `{% capture var %}hello{% endcapture %}`,
        `{% case x %}{% when 1 %}one{% endcase %}`,
      ];

      for (const sourceCode of validBlocks) {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
        expect(
          unknownTagOffenses,
          `Expected no unknown tag offense for: ${sourceCode}`,
        ).toHaveLength(0);
      }
    });

    it('should not report platformOS-specific tags', async () => {
      const validTags = [
        `{% log x %}`,
        `{% print x %}`,
        `{% yield 'content' %}`,
        `{% redirect_to '/path' %}`,
        `{% export x, namespace: "ns" %}`,
        `{% return x %}`,
        `{% response_status 200 %}`,
        `{% response_headers 'Content-Type': 'text/html' %}`,
        `{% sign_in user %}`,
        `{% spam_protection "recaptcha_v2" %}`,
        `{% theme_render_rc 'rc' %}`,
      ];

      for (const sourceCode of validTags) {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
        expect(
          unknownTagOffenses,
          `Expected no unknown tag offense for: ${sourceCode}`,
        ).toHaveLength(0);
      }
    });

    it('should not report platformOS block tags', async () => {
      const validBlocks = [
        `{% cache 'key' %}hello{% endcache %}`,
        `{% parse_json var %}{}{% endparse_json %}`,
        `{% try %}hello{% catch err %}{{ err }}{% endtry %}`,
        `{% content_for 'pagetitle' %}<title>Hello</title>{% endcontent_for %}`,
        `{% background source_name: 'my_task' %}echo "hello"{% endbackground %}`,
      ];

      for (const sourceCode of validBlocks) {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
        expect(
          unknownTagOffenses,
          `Expected no unknown tag offense for: ${sourceCode}`,
        ).toHaveLength(0);
      }
    });

    it('should not report raw tags', async () => {
      const sourceCode = `{% raw %}{{ not liquid }}{% endraw %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });

    it('should not report comment tags', async () => {
      const sourceCode = `{% comment %}this is a comment{% endcomment %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });

    it('should not report inline comment tags', async () => {
      const sourceCode = `{% # this is an inline comment %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });

    it('should not report else/elsif tags', async () => {
      const sourceCode = `{% if true %}a{% elsif false %}b{% else %}c{% endif %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });
  });

  describe('tags known via docset', () => {
    it('should not report tags from the docset', async () => {
      const sourceCode = `{% custom_docset_tag %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode, 'file.liquid', {
        platformosDocset: {
          async filters() {
            return [];
          },
          async objects() {
            return [];
          },
          async liquidDrops() {
            return [];
          },
          async tags() {
            return [{ name: 'custom_docset_tag' }];
          },
          async graphQL() {
            return null;
          },
        },
      });
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(0);
    });
  });

  describe('mixed valid and unknown tags', () => {
    it('should only report the unknown tags in mixed content', async () => {
      const sourceCode = `
        {% assign x = "hello" %}
        {% unknown_one %}
        {% if true %}
          {% bogus_tag %}
        {% endif %}
      `;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(2);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'unknown_one'");
      expect(unknownTagOffenses[1].message).toBe("Unknown tag 'bogus_tag'");
    });
  });

  describe('real-world file patterns', () => {
    it('should catch unknown tags in a real platformOS page with liquid block and standalone tag', async () => {
      const sourceCode = `---
method: post
slug: users
layout: 'modules/community/blank'
---

{% liquid
  function current_profile = 'modules/user/helpers/current_profile'

  include 'modules/user/helpers/can_do_or_redirect', requester: current_profile, do: 'users.register', redirect_url: "/"

  function object = 'modules/user/commands/user/create', first_name: params.first_name

  dsk

  if object.valid
    function _ = 'modules/user/commands/session/create', user_id: object.id
    include 'modules/core/helpers/redirect_to', url: '/onboarding'
  else
    assign values = object | default: null
    render 'modules/user/users/new', errors: object.errors, values: values
  endif
%}

{% jakdsajk %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(2);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'dsk'");
      expect(unknownTagOffenses[1].message).toBe("Unknown tag 'jakdsajk'");
    });
  });

  describe('edge cases', () => {
    it('should report unknown tags with underscores', async () => {
      const sourceCode = `{% my_custom_tag %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(1);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'my_custom_tag'");
    });

    it('should report unknown tags with whitespace-trimming delimiters', async () => {
      const sourceCode = `{%- unknown_tag -%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const unknownTagOffenses = offenses.filter((o) => o.message.includes('Unknown tag'));
      expect(unknownTagOffenses).toHaveLength(1);
      expect(unknownTagOffenses[0].message).toBe("Unknown tag 'unknown_tag'");
    });
  });

  /**
   * TASK-44. `{% layout %}` was a deploy-wide FALSE APPROVAL.
   *
   * The grammar carried a dedicated rule for it — Shopify inheritance that came along with the
   * fork — so the parser accepted it, no check objected, and the supervisor answered
   * `status: ok, must_fix_before_write: false`. The converter REJECTS it with
   * `Unknown tag 'layout'`, and a converter rejection fails the WHOLE changeset, so an agent
   * told "write this" took every other file in the deploy down with it.
   *
   * Confirmed by two independent oracles: `pos-cli deploy --dry-run` (round 5) and
   * `/api/app_builder/liquid_exec` (re-measured here), in every form — with an argument,
   * `none`, bare, and inside `{% liquid %}`. Controls render, so the probes are sound.
   *
   * BOUNDED BY MEASUREMENT, not by the report. `eval/tag-vocabulary-sweep.mjs` runs all 50 tag
   * names the grammar carries against the runtime: `layout` is the ONLY one the platform answers
   * `Unknown tag` for. `ifchanged` was the other suspect — present in the grammar, absent from
   * the docset — and it renders, so it is not a second defect.
   */
  describe('{% layout %}, which platformOS does not implement', () => {
    const LAYOUT_FORMS: Array<[label: string, source: string]> = [
      ['with an argument', `{% layout 'application' %}`],
      ['with none', `{% layout none %}`],
      ['bare', `{% layout %}`],
      ['whitespace-trimmed', `{%- layout 'application' -%}`],
      ['inside a liquid tag', `{% liquid\n  layout 'application' %}`],
    ];

    for (const [label, sourceCode] of LAYOUT_FORMS) {
      it(`reports layout ${label}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

        expect(offenses.filter((o) => o.message.includes('Unknown tag'))).toHaveLength(1);
      });
    }

    it('tells the author what platformOS wants instead, not merely that the tag is unknown', async () => {
      // AC#2. "Unknown tag 'layout'" is accurate and useless — the author knows what they
      // wrote, and it reads like a typo rather than a missing feature. The remedy is measured:
      // platformOS selects a layout from page frontmatter.
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% layout 'application' %}`);
      const unknown = offenses.filter((o) => o.message.includes('Unknown tag'));

      expect(unknown.map((o) => o.message)).toEqual([
        "Unknown tag 'layout'. platformOS has no layout tag — it selects a layout from the " +
          'page frontmatter instead, e.g. `layout: application`.',
      ]);
    });

    it('does not attach that hint to an unrelated unknown tag', async () => {
      // The control. A hint appended unconditionally would satisfy the assertion above while
      // telling an author who mistyped `{% redirect_too %}` to go and edit their frontmatter.
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% redirect_too '/x' %}`);
      const unknown = offenses.filter((o) => o.message.includes('Unknown tag'));

      expect(unknown.map((o) => o.message)).toEqual(["Unknown tag 'redirect_too'"]);
    });

    it('leaves the layout CONCEPT alone — only the tag is gone', async () => {
      // `{{ content_for_layout }}` is an object and renders fine; `{% content_for %}` is a real
      // platformOS block tag; frontmatter is not this check's business. Removing the tag must not
      // have caught any of them.
      const unrelated = [
        `{{ content_for_layout }}`,
        `{% content_for 'slot' %}x{% endcontent_for %}`,
        `---\nlayout: application\n---\n<p>hi</p>`,
      ];

      const reported = await Promise.all(
        unrelated.map(async (source) =>
          (await runLiquidCheck(LiquidHTMLSyntaxError, source)).filter((o) =>
            o.message.includes('Unknown tag'),
          ),
        ),
      );

      expect(reported).toEqual(unrelated.map(() => []));
    });
  });
});
