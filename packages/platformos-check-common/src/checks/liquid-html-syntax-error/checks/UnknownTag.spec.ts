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
      const offenses = await runLiquidCheck(
        LiquidHTMLSyntaxError,
        sourceCode,
        'app/views/partials/file.liquid',
        {
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
        },
      );
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

  describe('the remedy hint for a tag platformOS does not implement', () => {
    it('tells the author what platformOS wants instead, not merely that the tag is unknown', async () => {
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
  });

  /**
   * Tags the platform REGISTERS and the official docs omit. `LiquidHTMLSyntaxError` is ERROR
   * severity and the MCP supervisor treats it as blocking, so reporting one is an unappealable
   * refusal of working code. See `src/registered-tags.ts` for the vocabulary.
   *
   * Each was also run through `/api/app_builder/liquid_exec` and failed for its OWN reason — a
   * missing argument, a partial that does not exist, a query name that does not resolve — never
   * with `Unknown tag`. That message is the discriminator: a bare `{% tag %}` fixture is
   * EXPECTED to fail for a tag that exists, and that failure is not evidence of absence.
   */
  describe('registered platformOS tags the official docs omit', () => {
    // Spelled as an author would write them, not bare, so a fixture that fails to parse
    // for an unrelated reason cannot masquerade as a pass.
    const REGISTERED_FORMS: Array<[label: string, source: string]> = [
      ['context_rc', `{% context_rc language: 'de' %}`],
      ['execute_query', `{% execute_query 'my_query' %}`],
      ['function_rc', `{% function_rc result = 'my_partial' %}`],
      ['query_graph', `{% query_graph 'my_query' %}`],
      ['render_form', `{% render_form 'my_form' %}`],
      ['return_rc', `{% return_rc my_value %}`],
      ['sign_in_rc', `{% sign_in_rc user_id: 1 %}`],
      ['try_rc', `{% try_rc %}body{% endtry_rc %}`],
    ];

    for (const [label, sourceCode] of REGISTERED_FORMS) {
      it(`does not report ${label}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

        expect(offenses.filter((o) => o.message.includes('Unknown tag'))).toEqual([]);
      });
    }

    it('reports NOTHING at all for them, not merely no unknown-tag offense', async () => {
      // The filter used above would hide a different offense landing on the same tag —
      // `InvalidTagSyntax`, say, which fires on a KNOWN tag whose markup will not parse.
      // These tags have no grammar rule, so their markup is a raw string, and a check that
      // treated raw markup as broken would re-block every one of them under a new message.
      const reported = await Promise.all(
        REGISTERED_FORMS.map(async ([, source]) =>
          (await runLiquidCheck(LiquidHTMLSyntaxError, source)).map((o) => o.message),
        ),
      );

      expect(reported).toEqual(REGISTERED_FORMS.map(() => []));
    });

    it('accepts try_rc as a BLOCK, including its close tag and its catch branch', async () => {
      // `try_rc` is the one the docset could not fix on its own. It is an alias of `try`,
      // and `try` is a block, so `{% endtry_rc %}` had to become recognisable too —
      // otherwise listing `try_rc` as a known tag would leave the close tag reported as
      // unknown and the file still blocked.
      //
      // The delimiter is MEASURED, not assumed to follow the canonical name:
      // `{% try_rc %}…{% endtry %}` is rejected by the platform with "'endtry' is not a
      // valid delimiter for try_rc tags. use endtry_rc".
      const forms = [
        `{% try_rc %}body{% endtry_rc %}`,
        `{% try_rc %}body{% catch err %}handled{% endtry_rc %}`,
        `{% liquid\n  try_rc\n    echo 'body'\n  catch err\n    echo 'handled'\n  endtry_rc\n%}`,
      ];

      const reported = await Promise.all(
        forms.map(async (source) =>
          (await runLiquidCheck(LiquidHTMLSyntaxError, source)).map((o) => o.message),
        ),
      );

      expect(reported).toEqual(forms.map(() => []));
    });

    it('still blocks a tag that is genuinely unknown', async () => {
      // AC#2's control, and the reason the fix is a vocabulary correction rather than a
      // suppression. Every "nothing was reported" assertion above would also pass if
      // `UnknownTag` had simply been switched off.
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% no_such_tag_zzz %}`);

      expect(offenses.map((o) => o.message)).toEqual(["Unknown tag 'no_such_tag_zzz'"]);
    });

    it('still blocks a close tag with no matching open tag', async () => {
      // The paired control for the `try_rc` block change. Teaching the grammar a new block
      // name must not make stray `end` tags acceptable — `{% endtry_rc %}` on its own is
      // as broken as it ever was.
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% endtry_rc %}`);

      expect(offenses).not.toEqual([]);
    });

    it('still blocks a near-miss spelling of a registered tag', async () => {
      // The names added are close to real ones, and a fix that matched loosely — by
      // prefix, or by stripping an `_rc` suffix — would accept these too. Each is a typo an
      // author would actually make.
      const typos = [`{% context_r %}`, `{% render_forms 'f' %}`, `{% execute_queries 'q' %}`];

      const reported = await Promise.all(
        typos.map(async (source) =>
          (await runLiquidCheck(LiquidHTMLSyntaxError, source))
            .filter((o) => o.message.includes('Unknown tag'))
            .map((o) => o.message),
        ),
      );

      expect(reported).toEqual([
        ["Unknown tag 'context_r'"],
        ["Unknown tag 'render_forms'"],
        ["Unknown tag 'execute_queries'"],
      ]);
    });
  });
});
