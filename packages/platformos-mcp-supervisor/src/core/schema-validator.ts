/**
 * platformOS schema YAML validator.
 *
 * Validates schema files (`app/schema/*.yml`) for:
 *   - Valid YAML syntax
 *   - Required top-level keys (`name`, `properties`)
 *   - `name` matches filename
 *   - Each property has required keys (`name`, `type`)
 *   - Valid property types
 *   - No duplicate property names
 *   - Upload `options` validation
 *   - No use of built-in field names
 *
 * Pure function. Only depends on `js-yaml`. Wraps `js-yaml` throws cleanly:
 * a parse error is surfaced as a single `pos-supervisor:SchemaYAML` error,
 * never propagates.
 */

import yaml from 'js-yaml';
import { basename } from 'node:path';
import type { Severity } from './constants';

// ── Public types ───────────────────────────────────────────────────────────

export interface SchemaValidatorDiagnostic {
  check: string;
  severity: Severity;
  message: string;
  line: number;
  column: number;
}

export interface SchemaValidatorResult {
  errors: SchemaValidatorDiagnostic[];
  warnings: SchemaValidatorDiagnostic[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_TYPES: ReadonlySet<string> = new Set([
  'string',
  'text',
  'integer',
  'float',
  'boolean',
  'datetime',
  'date',
  'array',
  'upload',
]);

const BUILTIN_FIELDS: ReadonlySet<string> = new Set(['id', 'created_at', 'updated_at', 'table']);

const VALID_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['name', 'properties']);

const VALID_PROPERTY_KEYS: ReadonlySet<string> = new Set(['name', 'type', 'options']);

// Keys that imply platform behavior that doesn't exist — these are errors, not
// warnings, because they give developers false confidence about data integrity.
const MISLEADING_PROPERTY_KEYS: Readonly<Record<string, string>> = {
  required:
    '`required` is not a schema-level concept in platformOS. Validation must be done in mutations/commands using `{% liquid if field == blank %}` or form validators.',
  default:
    '`default` is not supported in platformOS schemas. Set defaults in your mutation/command logic before `record_create`.',
  unique:
    '`unique` is not enforced at the schema level in platformOS. Use `records(filter: ...)` to check uniqueness before creating records.',
  index: '`index` is not a schema option. String properties are indexed by default; text properties are not.',
  nullable: '`nullable` is not a schema option. All properties are nullable by default in platformOS.',
  validation: '`validation` is not a schema-level concept. Validate in mutations/commands.',
  validates: '`validates` is not a schema-level concept. Validate in mutations/commands.',
  max_length: '`max_length` is not a schema option. Validate length in mutations/commands.',
  min_length: '`min_length` is not a schema option. Validate length in mutations/commands.',
  enum: '`enum` is not a schema option. Use a `string` type and validate allowed values in mutations/commands.',
  foreign_key: '`foreign_key` is not a schema concept. Use `_id` suffix convention and `related_record()` in GraphQL.',
  references: '`references` is not a schema concept. Use `_id` suffix convention and `related_record()` in GraphQL.',
  belongs_to:
    '`belongs_to` is not a schema key. Store the ID as a `string` property with `_id` suffix and query with `related_record()`.',
  has_many: '`has_many` is not a schema key. Query related records with `related_records()` in GraphQL.',
};

const VALID_UPLOAD_OPTIONS: ReadonlySet<string> = new Set(['acl', 'max_size', 'content_type']);
const VALID_ACL_VALUES: ReadonlySet<string> = new Set(['public', 'private']);

const TYPE_ALIASES: Readonly<Record<string, string>> = {
  str: 'string',
  string: 'string',
  varchar: 'string',
  char: 'string',
  int: 'integer',
  number: 'integer',
  bigint: 'integer',
  smallint: 'integer',
  double: 'float',
  decimal: 'float',
  numeric: 'float',
  real: 'float',
  bool: 'boolean',
  bit: 'boolean',
  timestamp: 'datetime',
  time: 'datetime',
  blob: 'upload',
  file: 'upload',
  image: 'upload',
  json: 'array',
  list: 'array',
  longtext: 'text',
  mediumtext: 'text',
  varchar2: 'string',
};

// ── Internal types ─────────────────────────────────────────────────────────

interface YamlPropertyShape {
  name?: unknown;
  type?: unknown;
  options?: unknown;
  [key: string]: unknown;
}

interface YamlSchemaShape {
  name?: unknown;
  properties?: unknown;
  [key: string]: unknown;
}

interface YamlExceptionLike {
  reason?: string;
  message?: string;
  mark?: { line?: number; column?: number };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Validate a platformOS schema YAML file.
 *
 * @param content  Raw YAML content
 * @param filePath File path (used for the name-vs-filename check)
 */
export function validateSchema(content: string, filePath: string): SchemaValidatorResult {
  const errors: SchemaValidatorDiagnostic[] = [];
  const warnings: SchemaValidatorDiagnostic[] = [];

  // 1. Parse YAML
  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch (e) {
    const err = e as YamlExceptionLike;
    errors.push({
      check: 'pos-supervisor:SchemaYAML',
      severity: 'error',
      message: `Invalid YAML syntax: ${err.reason ?? err.message ?? String(e)}`,
      line: err.mark?.line ?? 0,
      column: err.mark?.column ?? 0,
    });
    return { errors, warnings };
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema file must contain a YAML object with `name` and `properties` keys.',
      line: 0,
      column: 0,
    });
    return { errors, warnings };
  }

  const schema = doc as YamlSchemaShape;

  // 2. Check for unknown top-level keys
  for (const key of Object.keys(schema)) {
    if (!VALID_TOP_LEVEL_KEYS.has(key)) {
      warnings.push({
        check: 'pos-supervisor:SchemaStructure',
        severity: 'warning',
        message: `Unknown top-level key \`${key}\`. Valid keys: \`name\`, \`properties\`.`,
        line: findKeyLine(content, key),
        column: 0,
      });
    }
  }

  // 3. Required: name
  if (schema.name === undefined || schema.name === null || schema.name === '') {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema is missing required `name` key.',
      line: 0,
      column: 0,
    });
  } else if (typeof schema.name !== 'string') {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: '`name` must be a string.',
      line: findKeyLine(content, 'name'),
      column: 0,
    });
  } else {
    const expectedName = basename(filePath, '.yml');
    if (schema.name !== expectedName) {
      warnings.push({
        check: 'pos-supervisor:SchemaNameMismatch',
        severity: 'warning',
        message: `Schema \`name: ${schema.name}\` does not match filename \`${expectedName}.yml\`. The name should match the filename.`,
        line: findKeyLine(content, 'name'),
        column: 0,
      });
    }
  }

  // 4. Required: properties
  if (schema.properties === undefined || schema.properties === null) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema is missing required `properties` key.',
      line: 0,
      column: 0,
    });
    return { errors, warnings };
  }

  if (!Array.isArray(schema.properties)) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: '`properties` must be an array of property definitions.',
      line: findKeyLine(content, 'properties'),
      column: 0,
    });
    return { errors, warnings };
  }

  // 5. Validate each property
  const seenNames = new Set<string>();

  for (let i = 0; i < schema.properties.length; i++) {
    const raw = schema.properties[i];
    const propLabel = `properties[${i}]`;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: Each property must be an object with \`name\` and \`type\` keys.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
      continue;
    }

    const prop = raw as YamlPropertyShape;
    const displayName =
      typeof prop.name === 'string' && prop.name.length > 0 ? prop.name : propLabel;

    // Unknown / misleading property keys
    for (const key of Object.keys(prop)) {
      if (VALID_PROPERTY_KEYS.has(key)) continue;

      const misleadingMsg = MISLEADING_PROPERTY_KEYS[key];
      if (misleadingMsg) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property \`${displayName}\`: ${misleadingMsg}`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      } else {
        warnings.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'warning',
          message: `Property \`${displayName}\`: unknown key \`${key}\`. Valid keys: \`name\`, \`type\`, \`options\`.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
    }

    // Required: name
    if (prop.name === undefined || prop.name === null || prop.name === '') {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: Missing required \`name\` key.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else if (typeof prop.name !== 'string') {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: \`name\` must be a string.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else {
      if (seenNames.has(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Duplicate property name \`${prop.name}\`. Property names must be unique within a schema.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
      seenNames.add(prop.name);

      if (BUILTIN_FIELDS.has(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property name \`${prop.name}\` conflicts with built-in field. Built-in fields (id, created_at, updated_at, table) are added automatically.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }

      if (/^\d/.test(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property name \`${prop.name}\` must start with a letter, not a digit.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      } else if (prop.name !== prop.name.toLowerCase() || /[^a-z0-9_]/.test(prop.name)) {
        warnings.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'warning',
          message: `Property name \`${prop.name}\` should use snake_case (lowercase letters, numbers, underscores).`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
    }

    // Required: type
    if (prop.type === undefined || prop.type === null || prop.type === '') {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `Property \`${displayName}\`: Missing required \`type\` key.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else if (typeof prop.type !== 'string' || !VALID_TYPES.has(prop.type)) {
      const invalid = typeof prop.type === 'string' ? prop.type : String(prop.type);
      const suggestion = suggestType(invalid);
      errors.push({
        check: 'pos-supervisor:SchemaPropertyType',
        severity: 'error',
        message:
          `Property \`${displayName}\`: Invalid type \`${invalid}\`. Valid types: ${[...VALID_TYPES].join(', ')}.` +
          (suggestion ? ` Did you mean \`${suggestion}\`?` : ''),
        line: findPropertyLine(content, i),
        column: 0,
      });
    }

    // Upload options validation
    if (prop.type === 'upload' && prop.options !== undefined && prop.options !== null) {
      validateUploadOptions(prop, content, i, errors, warnings);
    } else if (
      prop.options !== undefined &&
      prop.options !== null &&
      prop.type !== 'upload' &&
      typeof prop.name === 'string'
    ) {
      warnings.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'warning',
        message: `Property \`${prop.name}\`: \`options\` is only valid for \`upload\` type properties.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    }
  }

  return { errors, warnings };
}

// ── Internals ──────────────────────────────────────────────────────────────

function validateUploadOptions(
  prop: YamlPropertyShape,
  content: string,
  propIndex: number,
  errors: SchemaValidatorDiagnostic[],
  warnings: SchemaValidatorDiagnostic[],
): void {
  const opts = prop.options;
  const displayName = typeof prop.name === 'string' ? prop.name : `properties[${propIndex}]`;

  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${displayName}\`: \`options\` must be an object.`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
    return;
  }

  const uploadOpts = opts as Record<string, unknown>;

  for (const key of Object.keys(uploadOpts)) {
    if (!VALID_UPLOAD_OPTIONS.has(key)) {
      warnings.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'warning',
        message: `Property \`${displayName}\`: Unknown upload option \`${key}\`. Valid options: acl, max_size, content_type.`,
        line: findPropertyLine(content, propIndex),
        column: 0,
      });
    }
  }

  if (uploadOpts.acl !== undefined && uploadOpts.acl !== null) {
    const aclValue = typeof uploadOpts.acl === 'string' ? uploadOpts.acl : String(uploadOpts.acl);
    if (!VALID_ACL_VALUES.has(aclValue)) {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `Property \`${displayName}\`: Invalid acl value \`${aclValue}\`. Must be \`public\` or \`private\`.`,
        line: findPropertyLine(content, propIndex),
        column: 0,
      });
    }
  }

  if (
    uploadOpts.max_size !== undefined &&
    uploadOpts.max_size !== null &&
    (typeof uploadOpts.max_size !== 'number' || uploadOpts.max_size <= 0)
  ) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${displayName}\`: \`max_size\` must be a positive number (bytes).`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
  }

  if (
    uploadOpts.content_type !== undefined &&
    uploadOpts.content_type !== null &&
    !Array.isArray(uploadOpts.content_type)
  ) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${displayName}\`: \`content_type\` must be an array of MIME type strings.`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
  }
}

/** Find the 0-based line number where a top-level key appears. */
function findKeyLine(content: string, key: string): number {
  const lines = content.split('\n');
  const re = new RegExp(`^${escapeRegex(key)}:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return 0;
}

/** Find the 0-based line number of the i-th `- name:` in the properties array. */
function findPropertyLine(content: string, index: number): number {
  const lines = content.split('\n');
  let count = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+-\s+name:/.test(lines[i]) || /^\s+-\s+\{/.test(lines[i])) {
      count++;
      if (count === index) return i;
    }
  }
  return findKeyLine(content, 'properties');
}

/** Suggest a valid type name for common typos. Returns `null` if no alias matches. */
function suggestType(invalidType: string): string | null {
  return TYPE_ALIASES[invalidType.toLowerCase()] ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
