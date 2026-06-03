/**
 * pos-supervisor:SchemaProperty rule — schema-validator emits messages that
 * are already concrete (built-in conflicts, duplicate names, snake_case
 * violations, invalid upload options, etc.). Pre-rule the check landed as
 * `.unmatched` because no rule module owned it; this rule just attaches a
 * stable `rule_id`, names the failure family in the hint, and points at the
 * schema domain guide for the rules-of-the-road.
 *
 * The upstream message already says exactly what to do — duplicating the
 * advice here would dilute it. The hint reframes the message into "what to
 * do next" without rewriting the diagnosis itself.
 */
import type { Rule } from './engine';

const MISLEADING_RE =
  /\b(required|default|unique|index|nullable|validation|validates|max_length|min_length|enum|foreign_key|references|belongs_to|has_many)\b.*not (a schema|supported|enforced)/i;

const HINT_BY_SUB: Record<string, string> = {
  builtin_conflict:
    'platformOS injects `id`, `created_at`, `updated_at`, and `table` automatically — declaring them in `properties` collides with the built-in. Remove the duplicate property; the built-in is queryable via GraphQL without any schema entry.',
  duplicate_name:
    'Property names within one schema must be unique. Rename one of the duplicates, or merge them if they describe the same field. Reference: schema YAML must produce a flat list of distinct named columns.',
  invalid_identifier:
    'Property names must start with a letter and use lowercase letters, digits, and underscores (`snake_case`). The platform creates a database column from the name; identifiers starting with digits or containing dashes are rejected at deploy time, not just by the linter.',
  snake_case:
    'platformOS expects `snake_case` for property names (lowercase letters, digits, underscores). camelCase / kebab-case names break GraphQL field generation and pos-cli sync.',
  upload_options:
    '`upload` properties take an `options` object with `acl` (`public` or `private`), `max_size` (bytes), and `content_type` (regex or string). Unknown keys are dropped silently at runtime — confusing because the linter is the only signal.',
  missing_field:
    'Each entry in `properties:` must declare both a `name` (string, snake_case) and a `type` (one of the supported scalars). Without both, pos-cli will refuse to deploy the schema.',
  misleading_key:
    'platformOS schemas only validate **shape and storage**, not semantics. Constraints like `required`, `default`, `unique`, `enum`, etc. live in commands and form validators — implement them there, not in the YAML.',
  default:
    'Schema property failed validation. The upstream message names the exact rule that fired; consult `domain_guide(schema)` for the canonical shape and the list of supported field types.',
};

const FIX_BY_SUB: Record<string, string> = {
  builtin_conflict:
    'Remove the property from `properties:` — id, created_at, updated_at, and table are platform-managed.',
  duplicate_name:
    'Rename one of the duplicates so every `name:` is distinct, or remove the redundant entry.',
  invalid_identifier:
    'Rename to start with a letter and use lowercase letters / digits / underscores (snake_case).',
  snake_case: 'Rewrite the name in lowercase snake_case (e.g. `MyField` → `my_field`).',
  upload_options:
    'Use only `acl` (public|private), `max_size` (integer bytes), `content_type` (string or regex) under `options:`. Drop any other keys.',
  missing_field:
    'Add the missing `name:` or `type:` key. Both are required for every entry under `properties:`.',
  misleading_key:
    'Remove the unsupported key from the schema and implement the same intent in the related command (validation) or form (defaults).',
  default:
    'Read the upstream message — it identifies the offending property and rule. Consult `domain_guide(schema)` for the canonical schema layout.',
};

export const rules: Rule[] = [
  {
    id: 'SchemaProperty.default',
    check: 'pos-supervisor:SchemaProperty',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const msg = diag.message ?? '';

      // Identify the most actionable family so the rule_id and fix can
      // diverge slightly even though we share one priority bucket. Sub-IDs
      // give analytics granularity without proliferating rule files.
      let subId = 'default';
      if (/conflicts with built-in field/i.test(msg)) subId = 'builtin_conflict';
      else if (/Duplicate property name/i.test(msg)) subId = 'duplicate_name';
      else if (/must start with a letter/i.test(msg)) subId = 'invalid_identifier';
      else if (/should use snake_case/i.test(msg)) subId = 'snake_case';
      else if (
        /Unknown upload option|Invalid acl value|`options` must be an object|`options` is only valid/i.test(
          msg,
        )
      )
        subId = 'upload_options';
      else if (/Missing required `name`|Missing required `type`|must be a string/i.test(msg))
        subId = 'missing_field';
      else if (MISLEADING_RE.test(msg)) subId = 'misleading_key';

      return {
        rule_id: `SchemaProperty.${subId}`,
        hint_md: HINT_BY_SUB[subId] ?? HINT_BY_SUB.default,
        fixes: [{ type: 'guidance', description: FIX_BY_SUB[subId] ?? FIX_BY_SUB.default }],
        confidence: 0.85,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'schema' },
          reason:
            'Schema property error. domain_guide(schema) lists every supported field, type, and option.',
        },
      };
    },
  },
];
