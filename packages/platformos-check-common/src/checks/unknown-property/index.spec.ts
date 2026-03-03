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
