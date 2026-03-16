import { expect, describe, it, assert } from 'vitest';
import { UndefinedObject } from './index';
import { runLiquidCheck, highlightedOffenses } from '../../test';
import { Offense } from '../../types';

describe('Module: UndefinedObject', () => {
  it('should report an offense when object is undefined', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['my_var']);
  });

  it('should report an offense when object with an attribute is undefined', async () => {
    const sourceCode = `
      {{ my_var.my_attr }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should report an offense when undefined object is used as an argument', async () => {
    const sourceCode = `
      {{ product[my_object] }}
      {{ product[my_object] }}

      {% comment %} string arguments should not be reported {% endcomment %}
      {{ product["my_object"] }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(2);
    expect(offenses.map((e) => e.message)).toEqual([
      "Unknown object 'my_object' used.",
      "Unknown object 'my_object' used.",
    ]);
  });

  it('should report an offense when object is undefined in a Liquid tag', async () => {
    const sourceCode = `
    {% liquid
      echo my_var
    %}
  `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
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
      {{ product[prop] }}
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
      {% for c in collections %}
        {{ c }}
      {% endfor %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is defined in a for loop but used outside of the scope', async () => {
    const sourceCode = `
      {% for c in collections %}
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

  it('should report an offense when function result variable is used before its definition', async () => {
    const sourceCode = `
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

  it('should report an offense when a variable partial in include is undefined', async () => {
    const sourceCode = `
      {% include undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'undefined_partial' used.");
  });

  it('should not report an offense when a variable partial in include is defined', async () => {
    const sourceCode = `
      {% assign partial_name = 'some/partial' %}
      {% include partial_name %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when a variable partial in function is undefined', async () => {
    const sourceCode = `
      {% function result = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'undefined_partial' used.");
  });

  it('should not report an offense for the result variable itself in function tag', async () => {
    const sourceCode = `
      {% function result = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    // only 'undefined_partial' should be reported, not 'result'
    expect(offenses.every((o) => o.message !== "Unknown object 'result' used.")).toBe(true);
  });

  it('should report offenses for lookup key variables in function result target and partial', async () => {
    const sourceCode = `
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

  it('should check the partial variable in function but not the hash-access result target base', async () => {
    const sourceCode = `
      {% parse_json my_hash %}{}{% endparse_json %}
      {% function my_hash['key'] = undefined_partial %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    const messages = offenses.map((o) => o.message);
    expect(messages).toContain("Unknown object 'undefined_partial' used.");
    expect(messages).not.toContain("Unknown object 'my_hash' used.");
  });

  it('should report an offense when object is defined in a for loop but used outside of the scope (in scenarios where the same variable has multiple scopes in the file)', async () => {
    const sourceCode = `
      {% for c in collections %}
        {% comment %} -- Scope 1 -- {% endcomment %}
        {{ c }}
      {% endfor %}
      {{ c }}
      {% for c in collections %}
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

  it('should report an offense when undefined object defines another object', async () => {
    const sourceCode = `
      {% assign my_object = my_var %}
      {{ my_object }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_var' used."]);
  });

  it('should not report an offense when object is defined in a tablerow loop', async () => {
    const sourceCode = `
      {% tablerow c in collections %}
        {{ c }}
      {% endtablerow %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should report an offense when object is defined in a tablerow loop but used outside of the scope', async () => {
    const sourceCode = `
      {% tablerow c in collections %}
        {{ c }}
      {% endtablerow %}{{ c }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'c' used."]);
  });

  it('should contextually report on the undefined nature of the form object (defined in form tag, undefined outside)', async () => {
    const sourceCode = `
      {% form "cart" %}
        {{ form }}
      {% endform %}{{ form }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'form' used."]);
  });

  it('should support {% layout none %}', async () => {
    const sourceCode = `
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

  it('should report an offense when object is undefined in a "partial" file with doc tags that are missing the associated param', async () => {
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

  it('should report an offense when object is not global', async () => {
    const sourceCode = `
      {{ image }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'image' used."]);
  });

  it('should not report an offense for forloop/tablerowloop variables when in the correct context', async () => {
    for (const tag of ['for', 'tablerow']) {
      const sourceCode = `
        {% ${tag} x in collections %}
          {{ ${tag}loop }}
        {% end${tag} %}
      `;

      const offenses = await runLiquidCheck(UndefinedObject, sourceCode, 'file.liquid');

      expect(offenses).toHaveLength(0);
    }
  });

  it('should support contextual exceptions for partials', async () => {
    let offenses: Offense[];
    const contexts: [string, string][] = [['app', 'app/views/partials/theme-app-extension.liquid']];
    for (const [object, goodPath] of contexts) {
      offenses = await runLiquidCheck(UndefinedObject, `{{ ${object} }}`, goodPath);
      expect(offenses).toHaveLength(0);
      offenses = await runLiquidCheck(UndefinedObject, `{{ ${object} }}`, 'file.liquid');
      expect(offenses).toHaveLength(1);
    }
  });

  it('should report an offense for forloop/tablerowloop used outside of context', async () => {
    const sourceCode = `
      {{ forloop }}
      {{ tablerowloop }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode, 'file.liquid');

    expect(offenses).toHaveLength(2);
  });

  it('should not report an offenses when definitions for global objects are unavailable', async () => {
    const sourceCode = `
      {{ my_var }}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode, 'file.liquid', {
      platformosDocset: undefined,
    });

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

  it('should report an offense when assigning an undefined variable to itself', async () => {
    const sourceCode = `
      {% assign my_var = my_var | default: "fallback" %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'my_var' used.");
  });

  it('should report an offense when undefined variable is used inside background block', async () => {
    const sourceCode = `
      {% background source_type: 'some form' %}
        {{ undefined_var }}
      {% endbackground %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
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

  it('should report an offense when job_id is used before background file-based tag', async () => {
    const sourceCode = `
      {{ my_job }}
      {% background my_job = 'some_partial' %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses.map((e) => e.message)).toEqual(["Unknown object 'my_job' used."]);
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

  it('should report an offense when parse_json variable is used before the tag', async () => {
    const sourceCode = `
      {{ groups_data }}
      {% parse_json groups_data %}
        { "hello": "world" }
      {% endparse_json %}
    `;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'groups_data' used.");
  });

  it('should not report params as undefined when YAML frontmatter declares metadata.params', async () => {
    const sourceCode = `---
metadata:
  params:
    token:
      type: string
    email:
      type: string
---
{{ params.token }}
{{ params.email }}
`;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(0);
  });

  it('should still report other undefined objects when frontmatter has metadata.params', async () => {
    const sourceCode = `---
metadata:
  params:
    token:
      type: string
---
{{ params.token }}
{{ undefined_var }}
`;

    const offenses = await runLiquidCheck(UndefinedObject, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toBe("Unknown object 'undefined_var' used.");
  });
});
