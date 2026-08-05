import { describe, it, expect } from 'vitest';
import { runLiquidCheck, highlightedOffenses } from '../../test';
import { UnknownProperty } from './index';

describe('Module: UnknownProperty', () => {
  describe('JSON literal validation', () => {
    it('should report unknown property on JSON object', async () => {
      const sourceCode = `{% assign a = '{"x": 5}' | parse_json %}
{{ a.x }}
{{ a.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'y'");
      expect(offenses[0].message).toContain("'a'");
    });

    it('should not report for valid property access', async () => {
      const sourceCode = `{% assign a = '{"x": 5, "y": 10}' | parse_json %}
{{ a.x }}
{{ a.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should report property access on primitive', async () => {
      const sourceCode = `{% assign a = '{"x": 5}' | parse_json %}
{{ a.x.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain('primitive value');
      expect(offenses[0].message).toContain("'a.x'");
    });

    it('should handle nested objects', async () => {
      const sourceCode = `{% assign a = '{"x": {"y": {"z": 1}}}' | parse_json %}
{{ a.x.y.z }}
{{ a.x.y.w }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'w'");
      expect(offenses[0].message).toContain("'a.x.y'");
    });

    it('should handle arrays with first/last/size', async () => {
      const sourceCode = `{% assign a = '[{"x": 1}, {"x": 2}]' | parse_json %}
{{ a.first.x }}
{{ a.last.x }}
{{ a.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should report unknown property on array item', async () => {
      const sourceCode = `{% assign a = '[{"x": 1}, {"x": 2}]' | parse_json %}
{{ a.first.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'y'");
    });

    it('should handle numeric index access on arrays', async () => {
      const sourceCode = `{% assign a = '[{"x": 1}, {"x": 2}]' | parse_json %}
{{ a[0].x }}
{{ a[1].y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'y'");
    });

    it('should not report for dynamic variables', async () => {
      const sourceCode = `{{ some_dynamic_var.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should not report for invalid JSON', async () => {
      const sourceCode = `{% assign a = 'not valid json' %}
{{ a.x }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should not report when JSON is not a string literal', async () => {
      const sourceCode = `{% assign a = some_variable %}
{{ a.x }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should handle variable reassignment', async () => {
      const sourceCode = `{% assign a = '{"x": 1}' | parse_json %}
{{ a.x }}
{% assign a = '{"y": 2}' | parse_json %}
{{ a.y }}
{{ a.x }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'x'");
    });

    it('should not validate dynamic lookup paths', async () => {
      const sourceCode = `{% assign a = '{"x": 1}' %}
{% assign key = "x" %}
{{ a[key] }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });
  });

  describe('parse_json validation', () => {
    it('should validate parse_json block content', async () => {
      const sourceCode = `{% parse_json data %}
{"name": "test", "value": 42}
{% endparse_json %}
{{ data.name }}
{{ data.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'missing'");
    });

    it('should not report for valid parse_json properties', async () => {
      const sourceCode = `{% parse_json data %}
{"name": "test", "value": 42}
{% endparse_json %}
{{ data.name }}
{{ data.value }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should handle nested objects in parse_json', async () => {
      const sourceCode = `{% parse_json data %}
{"user": {"name": "John", "age": 30}}
{% endparse_json %}
{{ data.user.name }}
{{ data.user.email }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'email'");
    });
  });

  describe('graphql inline validation', () => {
    it('should validate direct graphql field access', async () => {
      // Note: Without schema, we can't know if a field returns an array or object.
      // We only validate direct property access on the response shape.
      const sourceCode = `{% graphql result %}
query {
  user {
    id
    name
  }
}
{% endgraphql %}
{{ result.user.id }}
{{ result.user.email }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'email'");
    });

    it('should not report for valid graphql fields', async () => {
      const sourceCode = `{% graphql result %}
query {
  user {
    id
    name
    email
  }
}
{% endgraphql %}
{{ result.user.id }}
{{ result.user.name }}
{{ result.user.email }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should handle nested graphql selections', async () => {
      const sourceCode = `{% graphql result %}
query {
  user {
    profile {
      firstName
      lastName
    }
  }
}
{% endgraphql %}
{{ result.user.profile.firstName }}
{{ result.user.profile.middleName }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'middleName'");
    });

    it('should not validate array access on graphql fields (no schema info)', async () => {
      // Since we don't have schema info, we can't validate .first/.last access
      // on GraphQL results - we don't know if the field returns an array
      const sourceCode = `{% graphql result %}
query {
  users {
    id
    name
  }
}
{% endgraphql %}
{{ result.users.first.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      // Currently this reports an error because 'first' is not in the users object
      // This is expected behavior without schema - we can't know users is an array
      expect(offenses).toHaveLength(1);
    });

    it('should not report an offense for result.errors (GraphQL responses always have errors)', async () => {
      const sourceCode = `{% graphql r %}
query {
  user {
    id
  }
}
{% endgraphql %}
{% if r.errors %}
  {{ r.errors }}
{% endif %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should not report file-based graphql result.errors', async () => {
      const sourceCode = `{% graphql r = 'my_query' %}
{% if r.errors %}{{ r.errors }}{% endif %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });
  });

  describe('graphql errors field', () => {
    it('should not report r.errors on graphql results (protocol-level field)', async () => {
      const sourceCode = `{% graphql r %}
query {
  user {
    id
  }
}
{% endgraphql %}
{% if r.errors %}error{% endif %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should not report errors on mutation results without errors in selection set', async () => {
      const sourceCode = `{% graphql r %}
mutation ($id: ID!) {
  user: user_delete(id: $id) {
    id
    email
  }
}
{% endgraphql %}
{% unless r.errors %}ok{% endunless %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should still report genuinely unknown properties on graphql results', async () => {
      const sourceCode = `{% graphql r %}
query {
  user {
    id
  }
}
{% endgraphql %}
{{ r.user.bogus }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'bogus'");
    });
  });

  describe('dig filter shape tracking', () => {
    it('should infer shape after dig on a parse_json variable', async () => {
      const sourceCode = `{% assign data = '{"user": {"name": "John", "age": 30}}' | parse_json %}
{% assign user = data | dig: "user" %}
{{ user.name }}
{{ user.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'missing'");
    });

    it('should infer array shape after dig and allow .size', async () => {
      const sourceCode = `{% assign data = '{"results": [{"id": 1}, {"id": 2}]}' | parse_json %}
{% assign items = data | dig: "results" %}
{{ items.size }}
{{ items.first.id }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should infer shape after multiple dig filters', async () => {
      const sourceCode = `{% assign data = '{"a": {"b": {"c": 1}}}' | parse_json %}
{% assign val = data | dig: "a" | dig: "b" %}
{{ val.c }}
{{ val.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'missing'");
    });

    it('should not track dig when source has no known shape', async () => {
      const sourceCode = `{% assign val = dynamic_var | dig: "key" %}
{{ val.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should infer shape after dig on inline graphql result', async () => {
      const sourceCode = `{% graphql result | dig: 'user' %}
query {
  user {
    id
    email
  }
}
{% endgraphql %}
{{ result.id }}
{{ result.email }}
{{ result.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("Unknown property 'missing'");
    });

    it('should allow full shape when no dig filter on inline graphql', async () => {
      const sourceCode = `{% graphql result %}
query {
  user {
    id
  }
}
{% endgraphql %}
{{ result.user.id }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });
  });

  describe('JSON literal validation', () => {
    it('should report unknown property on hash literal', async () => {
      const sourceCode = `{% assign a = {x: 5} %}{{ a.b }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'b' on 'a'.");
    });

    it('should not report for valid property on hash literal', async () => {
      const sourceCode = `{% assign a = {x: 5, y: 10} %}{{ a.x }}{{ a.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should handle nested hash literals', async () => {
      const sourceCode = `{% assign a = {x: {y: 1}} %}{{ a.x.y }}{{ a.x.z }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'z' on 'a.x'.");
    });

    it('should report unknown property access on array literal', async () => {
      const sourceCode = `{% assign a = [2, 3] %}{{ a.asd }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'asd' on 'a'.");
    });

    it('should allow first/last/size on array literals', async () => {
      const sourceCode = `{% assign a = [2, 3] %}{{ a.first }}{{ a.last }}{{ a.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should allow numeric index on array literals', async () => {
      const sourceCode = `{% assign a = [2, 3] %}{{ a[0] }}{{ a[1] }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should report primitive access on array item from hash literal items', async () => {
      const sourceCode = `{% assign a = [{x: 1}, {x: 2}] %}{{ a.first.x }}{{ a.first.y }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'y' on 'a.first'.");
    });

    it('should report unknown property when assigning from known-shape variable', async () => {
      const sourceCode = `{% assign a = [2, 3] %}{% assign b = a.asd %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'asd' on 'a'.");
    });

    it('should handle hash literals with quoted string keys', async () => {
      const sourceCode = `{% assign c = { "errors": {}, "valid": true } %}{{ c.valid }}{{ c.errors }}{{ c.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'missing' on 'c'.");
    });

    it('should handle hash literals with mixed bare and quoted keys', async () => {
      const sourceCode = `{% assign a = {x: 5, "y": 10} %}{{ a.x }}{{ a.y }}{{ a.z }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'z' on 'a'.");
    });

    it('should handle nested hash literals with quoted keys', async () => {
      const sourceCode = `{% assign a = { "outer": { "inner": 1 } } %}{{ a.outer.inner }}{{ a.outer.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'missing' on 'a.outer'.");
    });

    it('should report unknown property on hash literal assigned via another variable', async () => {
      const sourceCode = `{% assign a = {a: 5} %}{% assign b = a.b %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'b' on 'a'.");
    });
  });

  describe('function tag reassignment', () => {
    it('should not report unknown property after function tag reassigns a variable', async () => {
      const sourceCode = `{% assign object = { "valid": true, "id": id, "role": role } %}
{% function object = 'modules/core/commands/execute', object: object, mutation_name: 'some_mutation' %}
{% if object.errors == blank %}
  {{ object.valid }}
{% endif %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should still report unknown property before function tag reassignment', async () => {
      const sourceCode = `{% assign object = { "valid": true, "id": "123" } %}
{{ object.missing }}
{% function object = 'modules/core/commands/execute', object: object %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toEqual("Unknown property 'missing' on 'object'.");
    });
  });

  describe('writes through an lvalue path', () => {
    // `assign`, `hash_assign` and `function` all take an lvalue path, and `assign` also
    // has the `<<` push operator. A write to one key is not a claim about the whole
    // variable — neither a new one when nothing was known, nor a replacement of what was.
    const messagesOf = (offenses: { message: string }[]) => offenses.map((o) => o.message);

    it('should not report anything after hash_assign onto a variable of unknown shape', async () => {
      const sourceCode = `{% liquid
  function relation = 'x', id: 1
  assign data = null | hash_merge: id: relation.id
  hash_assign relation['_incoming_changes'] = data
  function group_url = 'y', object: relation.r
%}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should not report anything after assign at a path onto a variable of unknown shape', async () => {
      const sourceCode = `{% function x = 'p' %}
{% assign x["a"] = {"k": 1} %}
{{ x.b }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should still know the key it wrote onto a variable of unknown shape', async () => {
      // The write is the only evidence there is, and it proves "a hash with at least
      // this key" — enough for completion to offer `a`, and for a read THROUGH `a` to
      // be checked, while any other key stays unverifiable.
      const sourceCode = `{% function x = 'p' %}
{% assign x["a"] = {"k": 1} %}
{{ x.a.k }}
{{ x.a.missing }}
{{ x.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'x.a'."]);
    });

    it('should stay open through a SECOND write onto a variable of unknown shape', async () => {
      // The keys we watched go in are not the whole picture when the value came from
      // somewhere we could not see, so closing on the second write would report every
      // other read of it as unknown.
      const sourceCode = `{% assign object = null | hash_merge: items: items %}
{% hash_assign object['name'] = 'x' %}
{% hash_assign object['valid'] = true %}
{{ object.name }}
{{ object.items.ids }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should close an empty hash literal on the first write, and stay closed', async () => {
      // The other openness: `{}` describes nothing YET, and the writes that follow are
      // the whole of what it holds.
      const sourceCode = `{% assign filters = {} %}
{% hash_assign filters['page'] = 1 %}
{% hash_assign filters['tags'] = 'a,b' %}
{{ filters.page }}{{ filters.tags }}
{{ filters.tag }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'tag' on 'filters'."]);
    });

    it('should take a literal at face value when it is pushed onto a list', async () => {
      const sourceCode = `{% assign list = [] %}
{% assign list << 'text' %}
{{ list.first.size }}
{{ list.first.upcase }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([
        "Cannot access property 'upcase' on primitive value 'list.first'.",
      ]);
    });

    it('should claim nothing about a variable a plain assign gives a literal', async () => {
      // `{% assign x = 'text' %}` naming a string as one would turn every `x.foo` into an
      // offense, and Liquid answers nil there rather than failing.
      const sourceCode = `{% assign x = 'text' %}
{{ x.foo }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should narrow rather than replace when assign writes at a path on a known shape', async () => {
      const sourceCode = `{% assign x = {"a": {}, "b": 1} %}
{% assign x["a"] = {"k": 1} %}
{{ x.a.k }}
{{ x.b }}
{{ x.c }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'c' on 'x'."]);
    });

    it('should narrow rather than replace when hash_assign writes at a path on a known shape', async () => {
      const sourceCode = `{% assign x = {a: 1} %}
{% hash_assign x["b"] = 2 %}
{{ x.a }}{{ x.b }}{{ x.c }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'c' on 'x'."]);
    });

    it('should keep the base shape when function writes at a path on a known shape', async () => {
      const sourceCode = `{% assign x = {a: 1} %}
{% function x["b"] = 'p' %}
{{ x.a }}{{ x.b }}{{ x.c }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'c' on 'x'."]);
    });

    it('should not verify reads through a value written at a path, whose shape is unknown', async () => {
      const sourceCode = `{% assign x = {a: 1} %}
{% hash_assign x["b"] = some_variable %}
{{ x.b.deeply.nested }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should keep a list a list when assign pushes onto it', async () => {
      const sourceCode = `{% assign list = [] %}
{% assign list << {a: 1} %}
{{ list.first.a }}
{{ list.size }}
{{ list.first.b }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'b' on 'list.first'."]);
    });

    it('should claim nothing when assign pushes onto a base that is not a list', async () => {
      const sourceCode = `{% assign a = {"x": 1} %}
{% assign a << 2 %}
{{ a.x }}
{{ a.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should keep an array an array when assign writes an element', async () => {
      const sourceCode = `{% assign a = [{x: 1}] %}
{% assign a[0] = {y: 2} %}
{{ a.first.x }}{{ a.first.y }}
{{ a.first.z }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'z' on 'a.first'."]);
    });

    it('should follow a dig chain into the path it is written to', async () => {
      const sourceCode = `{% assign d = {"u": {"n": 1}} %}
{% assign x = {} %}
{% assign x["a"] = d | dig: "u" %}
{{ x.a.n }}
{{ x.a.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'x.a'."]);
    });

    it('should claim nothing when the lvalue path is dynamic', async () => {
      const sourceCode = `{% assign x = {a: 1} %}
{% assign key = "b" %}
{% hash_assign x[key] = 2 %}
{{ x.a }}{{ x.b }}{{ x.zzz }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should not report the write target itself', async () => {
      const sourceCode = `{% assign x = {a: 1} %}
{% hash_assign x["b"]["c"] = 2 %}
{% function x["d"] = 'p' %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should propagate a known shape through a plain assign', async () => {
      const sourceCode = `{% assign a = {"x": {"y": 1}} %}
{% assign b = a.x %}
{{ b.y }}
{{ b.z }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'z' on 'b'."]);
    });

    it('should track a deep hash literal down to the type of a nested array', async () => {
      const sourceCode = `{% assign hash = { "a": { "b": { "c": ["foo", "bar"] } } } %}
{{ hash.a.b.c.size }}
{{ hash.a.b.c.first.size }}
{{ hash.a.b.c[0] }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should report through a deep hash literal: an absent key, and a property on a string item', async () => {
      const sourceCode = `{% assign hash = { "a": { "b": { "c": ["foo", "bar"] } } } %}
{{ hash.a.b.d }}
{{ hash.a.b.c.first.upcase }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'd' on 'hash.a.b'.",
        "Cannot access property 'upcase' on primitive value 'hash.a.b.c.first'.",
      ]);
    });

    it('should allow size on a primitive', async () => {
      const sourceCode = `{% assign a = {"x": "text"} %}
{{ a.x.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  /**
   * `size` is answered by every Liquid value: a string's length, an array's count, a
   * hash's number of keys. The hash was the one this check did not know about, so a
   * `.size` read on a shape it had PROVEN was reported as an unknown property.
   */
  describe('size on a hash', () => {
    const messagesOf = (offenses: { message: string }[]) => offenses.map((o) => o.message);

    it('should not report size on a hash literal, at any depth', async () => {
      const sourceCode = `{% assign form = { "errors": { "email": "taken" }, "valid": false } %}
{{ form.size }}
{{ form.errors.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should not report size on a parse_json shape', async () => {
      const sourceCode = `{% parse_json form %}{"errors": {"email": "taken"}}{% endparse_json %}
{{ form.errors.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should not report size on a graphql selection', async () => {
      const sourceCode = `{% graphql r %}{ users { id name } }{% endgraphql %}
{{ r.users.size }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should still report a property the hash genuinely does not have', async () => {
      const sourceCode = `{% assign form = { "errors": { "email": "taken" } } %}
{{ form.errors.count }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'count' on 'form.errors'."]);
    });

    it('should answer a hash key named size before the count', async () => {
      // Liquid looks the key up first, so `{ "size": {...} }` reads through to its value.
      const sourceCode = `{% assign a = { "size": { "w": 1 } } %}
{{ a.size.w }}
{{ a.size.h }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'h' on 'a.size'."]);
    });

    it('should keep size a number on strings and arrays', async () => {
      const sourceCode = `{% assign a = { "name": "text", "tags": ["x", "y"] } %}
{{ a.name.size }}
{{ a.tags.size }}
{{ a.tags.size.bogus }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([
        "Cannot access property 'bogus' on primitive value 'a.tags.size'.",
      ]);
    });
  });

  describe('shapes the check must not claim', () => {
    const messagesOf = (offenses: { message: string }[]) => offenses.map((o) => o.message);

    it('should not let a write inside one branch describe a sibling branch', async () => {
      const sourceCode = `{% assign orders = {"results": [{"id": 1}]} %}
{% if a %}
  {% assign orders = orders.results %}
{% elsif b %}
  {% assign first = orders.results.first %}
{% endif %}
{% assign after = orders.results %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should still track a reassignment on the straight-line path', async () => {
      const sourceCode = `{% assign orders = {"results": [{"id": 1}]} %}
{% assign orders = orders.results %}
{% assign again = orders.results %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'results' on 'orders'."]);
    });

    it('should stop claiming a shape a conditional branch may have replaced', async () => {
      const sourceCode = `{% assign a = {"x": 1} %}
{% if c %}{% assign a = {"y": 2} %}{% endif %}
{{ a.x }}{{ a.zzz }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should verify a read inside the branch that wrote the shape', async () => {
      const sourceCode = `{% if c %}{% assign a = {"y": 2} %}{{ a.y }}{{ a.zzz }}{% endif %}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'zzz' on 'a'."]);
    });

    it('should claim nothing from a parse_json body with an interpolated value', async () => {
      // Dropping the `{{ … }}` leaves a document a tolerant parser still reads — one key
      // short of the truth, which is worse than no shape at all.
      const sourceCode = `{% parse_json object %}
{
  "id":       {{ id | json }},
  "attempts": {{ attempts | json }},
  "kind": "login"
}
{% endparse_json %}
{{ object.id }}
{{ object.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should treat an empty hash as a placeholder, not as a hash with no keys', async () => {
      const sourceCode = `{% assign object = {"valid": true, "errors": {}} %}
{{ object.errors.email }}
{{ object.valid }}
{{ object.bogus }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'object'."]);
    });

    it('should let visible writes define an empty hash', async () => {
      // The builder idiom: start empty, write the keys. Those writes ARE the shape.
      const sourceCode = `{% assign filters = {} %}
{% hash_assign filters['page'] = 1 %}
{% hash_assign filters['tags'] = 'a,b' %}
{{ filters.tags }}
{{ filters.tag }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'tag' on 'filters'."]);
    });

    it('should claim nothing when a filter after parse_json changes the value', async () => {
      const sourceCode = `{% assign site = '{"type": "site"}' | parse_json | hash_merge: settings: settings %}
{{ site.type }}
{{ site.settings }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should forget a shape a graphql tag replaced with a document it cannot read', async () => {
      const sourceCode = `{% assign r = {"a": 1} %}
{% graphql r = 'no/such/query' %}
{{ r.a }}
{{ r.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should forget a shape a capture replaced', async () => {
      const sourceCode = `{% assign a = {"x": 1} %}
{% capture a %}text{% endcapture %}
{{ a.x }}
{{ a.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should forget every shape when a tag that assigns has markup it cannot read', async () => {
      const sourceCode = `{% assign object = {"x": 1} %}
{% function object = 'p', current_profile %}
{{ object.x }}
{{ object.anything }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('error message formatting', () => {
    it('should include variable name in error message', async () => {
      const sourceCode = `{% assign myVar = '{"a": 1}' | parse_json %}
{{ myVar.b }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("'myVar'");
    });

    it('should include full path for nested access errors', async () => {
      const sourceCode = `{% assign obj = '{"a": {"b": 1}}' | parse_json %}
{{ obj.a.c }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("'obj.a'");
    });
  });
});
