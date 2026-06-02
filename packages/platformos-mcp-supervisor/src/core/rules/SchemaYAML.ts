/**
 * pos-supervisor:SchemaYAML rule — emitted when js-yaml fails to parse a
 * schema file. Pre-rule it landed as `.unmatched` because the upstream
 * message is just the raw js-yaml error reason. The rule attaches a stable
 * `rule_id`, gives the agent a short checklist of common YAML pitfalls in
 * platformOS schemas, and points at the schema domain guide for the
 * canonical shape.
 *
 * No `text_edit` — fixing arbitrary YAML syntax errors deterministically
 * requires a parser-aware rewrite we don't have. The hint plus the upstream
 * line/column is enough for the agent to repair it manually.
 */
import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'SchemaYAML.default',
    check: 'pos-supervisor:SchemaYAML',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'SchemaYAML.default',
      hint_md:
        'Schema YAML failed to parse. Read the upstream message — it carries the line and column from js-yaml. ' +
        'Common causes in platformOS schemas:\n' +
        '  • Single document only — schemas must contain ONE YAML document. A stray `---` separator emits ' +
        '"expected a single document in the stream".\n' +
        '  • Indentation mismatch — `properties:` items must align (two-space convention). Tabs break parsing.\n' +
        '  • Quoted vs bare strings — `name: "string"` and `name: string` both parse, but mixing quote styles ' +
        'in the same hash sometimes confuses agents (the parser is fine, the agent is not).\n' +
        '  • Trailing colon — `properties: ` followed by inline content on the next line without `- name:` ' +
        'usually means a missing dash or a missing key.\n\n' +
        'After fixing, re-run `validate_code` on the schema file. Reference: `domain_guide(schema)` shows the ' +
        'minimal valid shape (name + properties array of `{name, type}` objects).',
      fixes: [{
        type: 'guidance',
        description:
          'Open the file at the line/column from the upstream message, fix the YAML syntax, and re-validate. ' +
          'Most common pattern: an unaligned property entry or a stray `---` document separator. ' +
          'Use `domain_guide(schema)` to reference the minimal shape.',
      }],
      confidence: 0.7,
      see_also: {
        tool: 'domain_guide',
        args: { domain: 'schema' },
        reason: 'Schema YAML parse failure. domain_guide(schema) shows the canonical schema YAML shape.',
      },
    }),
  },
];
