/**
 * GraphQLCheck rules — GraphQL validation errors.
 *
 * Priority order:
 *   10 — unknown_field: field doesn't exist on type → schema-aware suggestions
 *   20 — unused_variable: variable declared but never used in query
 *   30 — type_mismatch: variable type doesn't match expected type
 *   100 — generic: fallback hint
 */
import type { Rule } from './engine';
import { nearestByLevenshtein } from './queries';

export const rules: Rule[] = [
  {
    id: 'GraphQLCheck.unknown_field',
    check: 'GraphQLCheck',
    priority: 10,
    when: (diag) => {
      const cat = diag.params?.category;
      return cat === 'unknown_field_record' || cat === 'unknown_field_other';
    },
    apply: (diag, facts) => {
      const params = diag.params!;
      const field = params.field;
      const typeName = params.type;
      const isRecord = params.category === 'unknown_field_record';

      if (isRecord && facts.graph) {
        const schemaNodes = facts.graph.nodesByType('schema');
        const allProps: string[] = [];
        for (const schema of schemaNodes) {
          if (schema.properties) {
            for (const p of schema.properties) {
              if (p.name) allProps.push(p.name);
            }
          }
        }

        const nearest = nearestByLevenshtein(field, allProps, 3);
        const suggestion = nearest.length > 0 ? `Did you mean \`${nearest[0].name}\`?` : null;
        const schemaList = schemaNodes
          .slice(0, 5)
          .map((s) => `\`${s.key}\``)
          .join(', ');

        return {
          rule_id: 'GraphQLCheck.unknown_field',
          hint_md: `Cannot query field \`${field}\` on type \`${typeName}\`. In platformOS, Record fields come from schema definitions (tables).${suggestion ? ` ${suggestion}` : ''}\n\nAvailable tables: ${schemaList}${schemaNodes.length > 5 ? ` (+${schemaNodes.length - 5} more)` : ''}. Use \`properties\` to access custom fields, not top-level field names.`,
          fixes: [],
          confidence: 0.85,
          see_also: {
            tool: 'domain_guide',
            args: { domain: 'graphql', section: 'gotchas' },
            reason:
              'Unknown field on Record type. domain_guide(graphql, gotchas) explains how to query schema properties via the properties hash.',
          },
        };
      }

      return {
        rule_id: 'GraphQLCheck.unknown_field',
        hint_md: `Cannot query field \`${field}\` on type \`${typeName}\`. Check the GraphQL schema for valid fields on this type.`,
        fixes: [],
        confidence: 0.6,
      };
    },
  },

  {
    id: 'GraphQLCheck.unused_variable',
    check: 'GraphQLCheck',
    priority: 20,
    when: (diag) => diag.params?.category === 'unused_variable',
    apply: (diag) => {
      const params = diag.params!;
      const varName = params.variable;
      return {
        rule_id: 'GraphQLCheck.unused_variable',
        hint_md: `Variable \`$${varName}\` is declared but never used in the query. Either remove the variable declaration or use it in the query body.\n\nCommon causes: leftover from refactoring, copy-paste from another query, variable intended for a filter that was removed.`,
        fixes: [],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'GraphQLCheck.type_mismatch',
    check: 'GraphQLCheck',
    priority: 30,
    when: (diag) => {
      const cat = diag.params?.category;
      return cat === 'type_mismatch_filter' || cat === 'type_mismatch_other';
    },
    apply: (diag) => {
      const params = diag.params!;
      const variable = params.variable;
      const actualType = params.actual_type;
      const expectedType = params.expected_type;
      const isFilter = params.category === 'type_mismatch_filter';

      if (isFilter) {
        return {
          rule_id: 'GraphQLCheck.type_mismatch',
          hint_md: `Type mismatch: expected \`${expectedType}\` but got \`${actualType}\`.${variable ? ` Variable: \`$${variable}\`.` : ''}\n\nplatformOS uses filter types like \`StringFilter\`, \`IntFilter\`, etc. Instead of passing a plain value, wrap it: \`{ value: "your_value" }\` or \`{ value_in: ["a", "b"] }\`.`,
          fixes: [],
          confidence: 0.85,
          see_also: {
            tool: 'domain_guide',
            args: { domain: 'graphql', section: 'gotchas' },
            reason:
              'Filter type mismatch. domain_guide(graphql, gotchas) explains platformOS filter input types and how to construct them.',
          },
        };
      }

      return {
        rule_id: 'GraphQLCheck.type_mismatch',
        hint_md: `Type mismatch: expected \`${expectedType}\` but got \`${actualType}\`.${variable ? ` Variable: \`$${variable}\`.` : ''} Check that the variable type in the query header matches the schema definition.`,
        fixes: [],
        confidence: 0.7,
      };
    },
  },

  {
    id: 'GraphQLCheck.generic',
    check: 'GraphQLCheck',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'GraphQLCheck.generic',
      hint_md:
        'GraphQL validation error. Check the query for syntax errors, undefined variables, or field name typos. Use `domain_guide(graphql)` for platformOS-specific GraphQL conventions.',
      fixes: [],
      confidence: 0.4,
      see_also: {
        tool: 'domain_guide',
        args: { domain: 'graphql' },
        reason:
          'GraphQL error. domain_guide(graphql) covers platformOS-specific GraphQL patterns, filter types, and common mistakes.',
      },
    }),
  },
];
