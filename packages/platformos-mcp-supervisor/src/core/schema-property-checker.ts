/**
 * Cross-check GraphQL queries / mutations against the project's schema YAML.
 *
 * Two regex sweeps:
 *   - `property(...)` / `property_int(...)` etc. accessors (read sites)
 *   - `{ name: "...", value(_int|_float|_boolean|_array): ... }` literals
 *     (write sites in mutation builders)
 *
 * For each occurrence we:
 *   1. Resolve the target table(s): the `table: "x"` argument when present,
 *      otherwise the parent GraphQL directory name singularised.
 *   2. Look up the schema YAML at `app/schema/<table>.yml` (or `.yaml`).
 *   3. Warn when the property is unknown, or when the accessor / value-key
 *      doesn't match the schema's declared type.
 *
 * Silent on filesystem failures (`readFileSync` / unparseable YAML) — the
 * caller already runs `validateSchema` against schema files independently,
 * so a malformed schema does not double-fire here.
 *
 * v1 trim: the source imports an unused `pluralize` from `project-scanner.js`
 * (declared but never called — only the local `singularize()` helper is used).
 * Dropped in the port.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Severity } from './constants';

// ── Public types ───────────────────────────────────────────────────────────

export interface SchemaPropertyCheckerDiagnostic {
  check: string;
  severity: Severity;
  message: string;
  line: number;
}

export interface SchemaPropertyCheckerResult {
  warnings: SchemaPropertyCheckerDiagnostic[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const BUILTIN_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'table',
  'type',
]);

const TYPE_TO_ACCESSOR: Readonly<Record<string, string>> = {
  string: 'property',
  text: 'property',
  datetime: 'property',
  date: 'property',
  integer: 'property_int',
  float: 'property_float',
  boolean: 'property_boolean',
  array: 'property_array',
  upload: 'property',
};

const TYPE_TO_VALUE_KEY: Readonly<Record<string, string>> = {
  string: 'value',
  text: 'value',
  datetime: 'value',
  date: 'value',
  integer: 'value_int',
  float: 'value_float',
  boolean: 'value_boolean',
  array: 'value_array',
  upload: 'value',
};

const ACCESSOR_REGEX = /\b(property(?:_int|_float|_boolean|_array)?)\s*\(\s*name\s*:\s*"([^"]+)"\s*\)/g;

const TABLE_REGEX = /table\s*:\s*(?:\{\s*value\s*:\s*)?"([^"]+)"/g;

const MUTATION_PROP_REGEX = /\{\s*name\s*:\s*"([^"]+)"\s*,\s*(value(?:_int|_float|_boolean|_array)?)\s*:/g;

// ── Internal types ─────────────────────────────────────────────────────────

type SchemaMap = Record<string, Map<string, string>>;

interface YamlSchemaShape {
  name?: unknown;
  properties?: unknown;
  [key: string]: unknown;
}

// ── Public entry points ────────────────────────────────────────────────────

export function checkSchemaProperties(
  content: string,
  filePath: string,
  projectDir: string | undefined | null,
): SchemaPropertyCheckerResult {
  const warnings: SchemaPropertyCheckerDiagnostic[] = [];

  if (!projectDir || !content) return { warnings };

  const tableNames = extractTableNames(content, filePath);
  if (tableNames.length === 0) return { warnings };

  const schemaMap = loadSchemas(projectDir, tableNames);
  if (Object.keys(schemaMap).length === 0) return { warnings };

  checkAccessors(content, tableNames, schemaMap, warnings);
  checkMutationProperties(content, tableNames, schemaMap, warnings);

  return { warnings };
}

export function extractTableNames(content: string, filePath: string): string[] {
  const names = new Set<string>();

  TABLE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_REGEX.exec(content)) !== null) {
    const name = m[1];
    if (!name.startsWith('modules/')) {
      names.add(name);
    }
  }

  if (names.size === 0 && filePath) {
    const pathTable = resolveTableFromPath(filePath);
    if (pathTable) names.add(pathTable);
  }

  return [...names];
}

export function resolveTableFromPath(filePath: string): string | null {
  const m = filePath.match(/(?:^|\/)(app\/graphql\/)([^/]+)\//);
  if (!m) return null;
  const dirName = m[2];
  return singularize(dirName);
}

export function loadSchemas(projectDir: string, tableNames: string[]): SchemaMap {
  const schemaDir = join(projectDir, 'app', 'schema');
  if (!existsSync(schemaDir)) return {};

  const result: SchemaMap = {};
  for (const tableName of tableNames) {
    const ymlPath = join(schemaDir, `${tableName}.yml`);
    const yamlPath = join(schemaDir, `${tableName}.yaml`);
    const filePath = existsSync(ymlPath) ? ymlPath : existsSync(yamlPath) ? yamlPath : null;
    if (!filePath) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      const doc = yaml.load(raw) as YamlSchemaShape | null | undefined;
      if (doc && Array.isArray(doc.properties)) {
        const props = new Map<string, string>();
        for (const entry of doc.properties as unknown[]) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const p = entry as { name?: unknown; type?: unknown };
          if (typeof p.name === 'string' && typeof p.type === 'string') {
            props.set(p.name, p.type);
          }
        }
        result[tableName] = props;
      }
    } catch {
      /* skip unparseable schemas — handled by validateSchema upstream */
    }
  }

  return result;
}

// ── Internals ──────────────────────────────────────────────────────────────

function singularize(name: string): string {
  if (name.endsWith('ies') && name.length > 3) {
    return name.slice(0, -3) + 'y';
  }
  if (
    name.endsWith('ses') ||
    name.endsWith('xes') ||
    name.endsWith('zes') ||
    name.endsWith('ches') ||
    name.endsWith('shes')
  ) {
    return name.slice(0, -2);
  }
  if (name.endsWith('s') && !name.endsWith('ss')) {
    return name.slice(0, -1);
  }
  return name;
}

function checkAccessors(
  content: string,
  tableNames: string[],
  schemaMap: SchemaMap,
  warnings: SchemaPropertyCheckerDiagnostic[],
): void {
  ACCESSOR_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACCESSOR_REGEX.exec(content)) !== null) {
    const accessor = m[1];
    const propName = m[2];

    if (BUILTIN_FIELDS.has(propName)) continue;

    for (const tableName of tableNames) {
      const schema = schemaMap[tableName];
      if (!schema) continue;

      const schemaType = schema.get(propName);
      if (schemaType === undefined) {
        warnings.push({
          check: 'pos-supervisor:UnknownSchemaProperty',
          severity: 'warning',
          message: `Property \`${propName}\` is not defined in schema \`${tableName}\`. Defined properties: ${
            [...schema.keys()].join(', ') || '(none)'
          }.`,
          line: lineOf(content, m.index),
        });
      } else {
        const expectedAccessor = TYPE_TO_ACCESSOR[schemaType];
        if (expectedAccessor && accessor !== expectedAccessor) {
          warnings.push({
            check: 'pos-supervisor:SchemaPropertyTypeMismatch',
            severity: 'warning',
            message: `Property \`${propName}\` has type \`${schemaType}\` in schema \`${tableName}\`, which requires \`${expectedAccessor}\` — found \`${accessor}\`.`,
            line: lineOf(content, m.index),
          });
        }
      }
    }
  }
}

function checkMutationProperties(
  content: string,
  tableNames: string[],
  schemaMap: SchemaMap,
  warnings: SchemaPropertyCheckerDiagnostic[],
): void {
  MUTATION_PROP_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MUTATION_PROP_REGEX.exec(content)) !== null) {
    const propName = m[1];
    const valueKey = m[2];

    if (BUILTIN_FIELDS.has(propName)) continue;

    for (const tableName of tableNames) {
      const schema = schemaMap[tableName];
      if (!schema) continue;

      const schemaType = schema.get(propName);
      if (schemaType === undefined) {
        warnings.push({
          check: 'pos-supervisor:UnknownSchemaProperty',
          severity: 'warning',
          message: `Property \`${propName}\` is not defined in schema \`${tableName}\`. Defined properties: ${
            [...schema.keys()].join(', ') || '(none)'
          }.`,
          line: lineOf(content, m.index),
        });
      } else {
        const expectedValueKey = TYPE_TO_VALUE_KEY[schemaType];
        if (expectedValueKey && valueKey !== expectedValueKey) {
          warnings.push({
            check: 'pos-supervisor:SchemaPropertyTypeMismatch',
            severity: 'warning',
            message: `Property \`${propName}\` has type \`${schemaType}\` in schema \`${tableName}\`, which requires \`${expectedValueKey}\` — found \`${valueKey}\`.`,
            line: lineOf(content, m.index),
          });
        }
      }
    }
  }
}

function lineOf(content: string, charIndex: number): number {
  let line = 0;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}
