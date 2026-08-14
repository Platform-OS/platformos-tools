import { expect, describe, it, assert } from 'vitest';
import { UndefinedObject } from './index';
import { runLiquidCheck, highlightedOffenses } from '../../test';
import { Offense } from '../../types';

describe('Module: UndefinedObject', () => {
  it('should not report offenses when no doc tag is present', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is undefined and doc tag is present', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);

    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['my_var']);
  });

  it('should report an offense when object with an attribute is undefined and doc tag is present', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ my_var.my_attr }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should report an offense when undefined object is used as an argument with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ context[my_object] }}
      {{ context[my_object] }}

      {% comment %} string arguments should not be reported {% endcomment %}
      {{ context["my_object"] }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(2);
    expect(offenses.map((e) => e.message)).toEqual([
      "Unknown object 'my_object' used.",
      "Unknown object 'my_object' used.",
    ]);
  });

  it('should report an offense when object is undefined in a Liquid tag with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% liquid
        echo my_var
      %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);

    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['my_var']);
  });

  it('should not report an offense when object is defined with an assign tag', async () => {
    const sourceCode = `
      {% assign my_var = "value" %}
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when object is defined with an assign tag and it is used as an argument', async () => {
    const sourceCode = `
      {% assign prop = "title" %}
      {{ context[prop] }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when object is defined with an assign tag in a Liquid tag', async () => {
    const sourceCode = `
      {% liquid
        assign my_var = "value"
        echo my_var
      %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when object is defined with a capture tag', async () => {
    const sourceCode = `
      {% capture my_var %} value {% endcapture %}
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when object is defined in a for loop', async () => {
    const sourceCode = `
      {% for c in items %}
        {{ c }}
      {% endfor %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is defined in a for loop but used outside of the scope with doc tag', async () => {
    const sourceCode = `
      {% doc %}
        @param {Array} items
      {% enddoc %}
      {% for c in items %}
        {{ c }}
      {% endfor %}{{ c }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'c' used."]);
  });

  it('should not report an offense for function result variables', async () => {
    const sourceCode = `
      {% function a = 'test' %}
      {{ a }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when function result variable is used before its definition with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ a }}
      {% function a = 'test' %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'a' used.");
  });

  it('should not report an offense for multiple function result variables', async () => {
    const sourceCode = `
      {% function result1 = 'partial_one' %}
      {% function result2 = 'partial_two' %}
      {{ result1 }}
      {{ result2 }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not register a scope variable when function target is a hash/array access', async () => {
    const sourceCode = `
      {% parse_json my_hash %}{"key": "value"}{% endparse_json %}
      {% function my_hash['result'] = 'test' %}
      {{ my_hash }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    // my_hash is defined via parse_json; function hash-access target does not shadow it
    expect(offenses).toHaveLength(0);
  });

  /**
   * The same unguarded read `extract-undefined-variables.ts` had: a `{% function %}`
   * the parser could not structure keeps its tag name and loses its markup to a raw
   * string, and `markup.name.lookups` threw on it — which aborted this check for the
   * whole file, so the undefined object AFTER the malformed tag went unreported.
   */
  it('should keep reporting after a function tag whose markup did not structure', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% liquid
        function settings = 'lib/queries/settings/load' | dig 'results'
      %}
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should not report offenses for undefined partials without doc tag', async () => {
    const sourceCode = `
      {% include undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when a variable partial in include is defined', async () => {
    const sourceCode = `
      {% assign partial_name = 'some/partial' %}
      {% include partial_name %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report offenses for undefined function partials without doc tag', async () => {
    const sourceCode = `
      {% function result = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense for the result variable itself in function tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% function result = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    // only 'undefined_partial' should be reported, not 'result'
    expect(offenses.every((o) => o.message !== "Unknown object 'result' used.")).toBe(true);
  });

  it('should report offenses for lookup key variables in function result target and partial with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% parse_json my_hash %}{}{% endparse_json %}
      {% function my_hash[lookup_key] = my_hash[path_var] %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    const messages = offenses.map((o) => o.message);
    // lookup_key and path_var are undefined; my_hash is defined
    expect(messages).toContain("Unknown object 'lookup_key' used.");
    expect(messages).toContain("Unknown object 'path_var' used.");
    expect(messages).not.toContain("Unknown object 'my_hash' used.");
  });

  it('should check the partial variable in function but not the hash-access result target base with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% parse_json my_hash %}{}{% endparse_json %}
      {% function my_hash['key'] = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    const messages = offenses.map((o) => o.message);
    expect(messages).toContain("Unknown object 'undefined_partial' used.");
    expect(messages).not.toContain("Unknown object 'my_hash' used.");
  });

  it('should report an offense when object is defined in a for loop but used outside of the scope (multiple scopes) with doc tag', async () => {
    const sourceCode = `
      {% doc %}
        @param {Array} items
      {% enddoc %}
      {% for c in items %}
        {% comment %} -- Scope 1 -- {% endcomment %}
        {{ c }}
      {% endfor %}
      {{ c }}
      {% for c in items %}
        {% comment %} -- Scope 2 -- {% endcomment %}
        {{ c }}
      {% endfor %}
      {{ c }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(2);
    expect(offenses.map((e) => e.message)).toEqual([
      "Unknown object 'c' used.",
      "Unknown object 'c' used.",
    ]);
  });

  it('should report an offense when undefined object defines another object with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% assign my_object = my_var %}
      {{ my_object }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should not report an offense when object is defined in a tablerow loop', async () => {
    const sourceCode = `
      {% tablerow c in items %}
        {{ c }}
      {% endtablerow %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is defined in a tablerow loop but used outside of the scope with doc tag', async () => {
    const sourceCode = `
      {% doc %}
        @param {Array} items
      {% enddoc %}
      {% tablerow c in items %}
        {{ c }}
      {% endtablerow %}{{ c }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'c' used."]);
  });

  it('should contextually report on the undefined nature of the form object with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% form method: "post" %}
        {{ form }}
      {% endform %}{{ form }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'form' used."]);
  });

  it('should support {% layout none %} with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% layout none %}
      {{ none }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'none' used."]);
  });

  it('should support {% increment var %} and {% decrement var %}', async () => {
    for (const tag of ['increment', 'decrement']) {
      const sourceCode = `
        {% ${tag} var %}
        {{ var }}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);
      expect(offenses).toHaveLength(0);
    }
  });

  it('should report an offense when object is undefined in a partial file with empty doc tag', async () => {
    const sourceCode = `
    {% doc %}
    {% enddoc %}
    {{ my_var }}
      `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/partials/file.liquid',
    );

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should leave an undeclared input of a documented partial to MissingDocParam', async () => {
    // Nothing in the file defines `legacy`, so it is a parameter the caller was meant to pass
    // and the doc does not declare — a hole in the contract, reported once on the partial by
    // `MissingDocParam`. Only a name the file DOES define and reads out of that definition's
    // scope stays here, which the loop and function tests above pin.
    const sourceCode = `
      {% doc %}
        @param {string} text
      {% enddoc %}
      {{ text }}{{ legacy }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should keep reporting an undeclared object when the doc declares no parameter', async () => {
    // No parameter means no declared contract, so `MissingDocParam` stands down and this
    // check is the only one left to say the read resolves to nothing.
    const sourceCode = `
      {% doc %}
        @description a card
      {% enddoc %}
      {{ legacy }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'legacy' used."]);
  });

  it('should not report an offense when object is defined with @param in a partial file', async () => {
    const sourceCode = `
      {% doc %}
        @param {string} text
      {% enddoc %}

      {{ text }}
    `;

    const filePath = 'app/views/partials/file.liquid';
    const offenses = await runLiquidCheck(UndefinedObject, sourceCode, filePath);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is not global with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ current_user }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'current_user' used."]);
  });

  it('should not report an offense for forloop/tablerowloop variables when in the correct context', async () => {
    for (const tag of ['for', 'tablerow']) {
      const sourceCode = `
        {% ${tag} x in items %}
          {{ ${tag}loop }}
        {% end${tag} %}
      `;

      const offenses = await runLiquidCheck(
        UndefinedObject,
        sourceCode,
        'app/views/partials/file.liquid',
      );

      expect(offenses).toHaveLength(0);
    }
  });

  // There is no "contextual objects" test any more, and the absence is deliberate. It covered a
  // hard-coded exemption that put `app` in scope in every partial — Shopify's theme app extension
  // drop, kept when the de-Shopify pass removed `section`, `recommendations` and `block` from the
  // same list. `app` is in no platformOS docset, so the exemption and its test went together.
  // Scope now comes from `objects.json` alone; `isObjectInScope` is where that rule lives.

  it('should report an offense for forloop/tablerowloop used outside of context with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ forloop }}
      {{ tablerowloop }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/partials/file.liquid',
    );

    expect(offenses).toHaveLength(2);
  });

  it('should not report an offenses when definitions for global objects are unavailable', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/partials/file.liquid',
      {
        platformosDocset: undefined,
      },
    );

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when a self defined variable is defined with a @param tag', async () => {
    const sourceCode = `
      {% doc %}
        @param {string} text
      {% enddoc %}

      {% assign text = text | default: "value" %}
    `;

    const filePath = 'app/views/partials/file.liquid';
    const offenses = await runLiquidCheck(UndefinedObject, sourceCode, filePath);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when assigning an undefined variable to itself with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% assign my_var = my_var | default: "fallback" %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'my_var' used.");
  });

  it('should not report offenses for undefined variables inside background block without doc tag', async () => {
    const sourceCode = `
      {% background source_type: 'some form' %}
        {{ undefined_var }}
      {% endbackground %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when job_id is used after background file-based tag', async () => {
    const sourceCode = `
      {% background my_job = 'some_partial' %}
      {{ my_job }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when job_id is used after background file-based tag with named args', async () => {
    const sourceCode = `
      {% background my_job = 'some_partial', source_type: 'some form' %}
      {{ my_job }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report offenses for job_id used before background tag without doc tag', async () => {
    const sourceCode = `
      {{ my_job }}
      {% background my_job = 'some_partial' %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should not report an offense when object is defined with a parse_json tag', async () => {
    const sourceCode = `
      {% parse_json groups_data %}
        { "hello": "world" }
      {% endparse_json %}
      {{ groups_data }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when parse_json variable is used before the tag with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {{ groups_data }}
      {% parse_json groups_data %}
        { "hello": "world" }
      {% endparse_json %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'groups_data' used.");
  });

  it('should not report an offense for catch variable inside catch block', async () => {
    const sourceCode = `
      {% try %}
        {{ "something" }}
      {% catch error %}
        {{ error }}
      {% endtry %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense for undefined variables in a page file even without doc tag', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/pages/home.liquid',
    );

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'my_var' used.");
  });

  it('should report an offense for undefined variables in a module page file even without doc tag', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const modulePaths = [
      'modules/my_module/public/views/pages/home.liquid',
      'modules/my_module/private/views/pages/home.liquid',
      'app/modules/my_module/public/views/pages/home.liquid',
      'app/modules/my_module/private/views/pages/home.liquid',
    ];

    for (const pagePath of modulePaths) {
      const offenses = await runLiquidCheck(UndefinedObject, sourceCode, pagePath);

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe("Unknown object 'my_var' used.");
    }
  });

  it('should not report offenses for global objects in a page file without doc tag', async () => {
    const sourceCode = `
      {{ context }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/pages/home.liquid',
    );

    expect(offenses).toHaveLength(0);
  });

  describe('an api_call object read outside an api_call', () => {
    // `data` and `response` are `global: true` in the docset, which means "needs no parent
    // object" and not "available everywhere" — they carry `app_file_type: 'api_call'`.
    // Reading `global` on its own put them in scope in every file.
    //
    // The `{% doc %}` tag is what opts a partial into this check at all.
    const withDoc = (body: string) => `{% doc %}\n{% enddoc %}\n${body}`;

    for (const object of ['data', 'response']) {
      it(`reports \`${object}\` in a partial`, async () => {
        const offenses = await runLiquidCheck(
          UndefinedObject,
          withDoc(`{{ ${object} }}`),
          'app/views/partials/card.liquid',
        );

        expect(offenses.map((offense) => offense.message)).toEqual([
          `Unknown object '${object}' used.`,
        ]);
      });

      it(`does not report \`${object}\` in an api_call`, async () => {
        const offenses = await runLiquidCheck(
          UndefinedObject,
          withDoc(`{{ ${object} }}`),
          'app/api_calls/send.liquid',
        );

        expect(offenses.map((offense) => offense.message)).toEqual([]);
      });
    }

    it('still treats `context` as in scope in a partial', async () => {
      const offenses = await runLiquidCheck(
        UndefinedObject,
        withDoc('{{ context.params.id }}'),
        'app/views/partials/card.liquid',
      );

      expect(offenses.map((offense) => offense.message)).toEqual([]);
    });
  });

  it('should not report offenses for assigned variables in a page file without doc tag', async () => {
    const sourceCode = `
      {% assign my_var = "hello" %}
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/pages/home.liquid',
    );

    expect(offenses).toHaveLength(0);
  });

  it('should respect @param in a page file with doc tag', async () => {
    const sourceCode = `
      {% doc %}
        @param {string} text
      {% enddoc %}
      {{ text }}
    `;

    const offenses = await runLiquidCheck(
      UndefinedObject,
      sourceCode,
      'app/views/pages/home.liquid',
    );

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense for catch variable used outside catch block with doc tag', async () => {
    const sourceCode = `
      {% doc %}
      {% enddoc %}
      {% try %}
        {{ "something" }}
      {% catch error %}
        {{ error }}
      {% endtry %}
      {{ error }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'error' used.");
  });

  describe('JSON literals in assign tag', () => {
    it('should report undefined bare key AND bare value in a hash literal', async () => {
      // bare keys and bare values are both VariableLookups in platformOS semantics —
      // they are evaluated at runtime, so both are subject to undefined-object checks
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign hash = { bare_key: bare_val } %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses.map((o) => o.message).sort()).toEqual([
        "Unknown object 'bare_key' used.",
        "Unknown object 'bare_val' used.",
      ]);
    });

    it('should NOT report string keys in a hash literal (they are literals, not variables)', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign hash = { "key": "val" } %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses).toHaveLength(0);
    });

    it('should report undefined bare value under a string key', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign hash = { "key": undefined_var } %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe("Unknown object 'undefined_var' used.");
    });

    it('should report undefined elements in an array literal', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign arr = [a, undefined_var] %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses.map((o) => o.message).sort()).toEqual([
        "Unknown object 'a' used.",
        "Unknown object 'undefined_var' used.",
      ]);
    });

    it('should NOT report string elements in an array literal', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign arr = ["a", "b", "c"] %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses).toHaveLength(0);
    });

    it('should NOT report bare keys/values when they refer to defined variables', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign bare_key = "k" %}
        {% assign bare_val = "v" %}
        {% assign hash = { bare_key: bare_val } %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses).toHaveLength(0);
    });

    it('should report undefined bare keys/values in nested hash literals', async () => {
      const sourceCode = `
        {% doc %}
        {% enddoc %}
        {% assign hash = { outer: { inner: value } } %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

      expect(offenses.map((o) => o.message).sort()).toEqual([
        "Unknown object 'inner' used.",
        "Unknown object 'outer' used.",
        "Unknown object 'value' used.",
      ]);
    });
  });
});
