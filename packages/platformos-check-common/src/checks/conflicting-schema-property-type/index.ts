import {
  App,
  AppFile,
  PROPERTY_BEARING_FILE_TYPES,
  SCHEMA_PROPERTY_TYPES,
} from '@platformos/platformos-common';
import { JSONNode } from '../../jsonc/types';
import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { isError } from '../../utils';
import { literalStringOf, schemaProperties } from '../schema-property-ast';

/** Where one property name is declared with one type: the type, and the files declaring it. */
type DeclaringPaths = Map<string, Set<string>>;

/**
 * One property name declared with two different types.
 *
 * The platform resolves a property's type BY NAME and instance-wide: its lookup takes a name
 * and no owning schema, so every declaration of that name — in any table, profile, transactable
 * or `user.yml`, app or module — answers together. Two types for one name therefore is not a
 * local inconsistency between two schemas that never meet; it changes how the name resolves for
 * EVERY query in the instance, including queries against a schema neither file touches.
 *
 * Measured on the platform: a `range` filter compiles to `properties->>'name'` (a text compare)
 * only while every declared type is a string-ish one, and to `properties->'name'` (a jsonb
 * compare) as soon as one is not. So adding an unrelated `expires_at: integer` to a second
 * schema turns a working `range: { gt: "2026-09-15T12:03:07+0000" }` on the FIRST schema into
 * `invalid input syntax for type json`, with nothing about the first schema having changed —
 * and a value that happens to parse as JSON, like `"2026"`, silently matches nothing instead.
 *
 * This is why the check is cross-file and cannot be a per-document rule: no single schema is
 * wrong on its own.
 */
export const ConflictingSchemaPropertyType: YAMLCheckDefinition = {
  meta: {
    code: 'ConflictingSchemaPropertyType',
    name: 'Conflicting Schema Property Type',
    docs: {
      description:
        'Reports a property declared with one type here and a different type in another schema. The platform resolves property types by name across every schema, so the two declarations resolve together.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/conflicting-schema-property-type',
    },
    type: SourceCodeType.YAML,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    let index: Promise<Map<string, DeclaringPaths>> | undefined;

    /**
     * Every `name: type` the project declares, and where. Built once per file checked, which
     * is what `MissingTable` does for tables — the sources are already in memory after the
     * first pass, so the repeat is a walk rather than a read.
     */
    function declaredTypes(): Promise<Map<string, DeclaringPaths>> {
      index ??= (async () => {
        const byName = new Map<string, DeclaringPaths>();

        for (const file of deployedPropertyFiles(context.app)) {
          await file.load();
          const ast = file.ast;
          // An unparseable schema belongs to `YAMLSyntaxError` alone, and contributes no
          // declaration rather than an empty one.
          if (isError(ast)) continue;

          for (const property of schemaProperties(ast as JSONNode)) {
            const declared = declaredType(property);
            if (!declared) continue;

            const paths = byName.get(declared.name) ?? new Map<string, Set<string>>();
            byName.set(declared.name, paths);
            const declaring = paths.get(declared.type) ?? new Set<string>();
            paths.set(declared.type, declaring);
            declaring.add(file.relativePath);
          }
        }

        return byName;
      })();

      return index;
    }

    return {
      async onCodePathStart(file) {
        if (!PROPERTY_BEARING_FILE_TYPES.has(context.fileType()!)) return;
        if (isError(file.ast)) return;
        // A `modules/<name>/…` original that an `app/modules/<name>/…` copy shadows never
        // deploys, so it declares nothing and reporting on it would send the reader to a file
        // whose contents the platform ignores.
        if (shadowedOriginals(context.app).has(file.uri)) return;

        const byName = await declaredTypes();

        for (const property of schemaProperties(file.ast)) {
          const declared = declaredType(property);
          if (!declared) continue;

          const conflicts = [...(byName.get(declared.name) ?? [])]
            .filter(([type]) => type !== declared.type)
            // One entry per conflicting TYPE, at its first declaring path: the actionable fact
            // is which other type exists and one place to go read it, and a name declared in
            // dozens of schemas must not produce a message nobody finishes.
            .map(([type, paths]) => [type, [...paths].sort()[0]] as const)
            .sort(([a], [b]) => a.localeCompare(b));

          if (conflicts.length === 0) continue;

          const elsewhere = conflicts.map(([type, path]) => `'${type}' in ${path}`).join(', ');

          context.report({
            message:
              `Property '${declared.name}' is declared as '${declared.type}' here and as ${elsewhere}. ` +
              `The platform resolves a property's type by name across every schema, so filters on '${declared.name}' see both.`,
            startIndex: declared.typeNode.loc.start.offset,
            endIndex: declared.typeNode.loc.end.offset,
          });
        }
      },
    };
  },
};

/**
 * A property entry's declared name and type, when the platform will read both literally AND
 * accept the type.
 *
 * An unaccepted type is dropped deliberately: it fails the deploy outright, so it can never
 * become one of the declarations a query resolves against, and `InvalidSchemaPropertyType`
 * already reports it. Warning a second time about a file that cannot ship would be noise.
 */
function declaredType(property: ReturnType<typeof schemaProperties>[number]) {
  const name = literalStringOf(property, 'name');
  const type = literalStringOf(property, 'type');
  if (!name || !type) return undefined;

  const declaredName = name.value as string;
  const declared = type.value as string;
  if (!(SCHEMA_PROPERTY_TYPES as readonly string[]).includes(declared)) return undefined;

  return { name: declaredName, type: declared, typeNode: type };
}

/** Every schema file whose `properties:` the deploy converts, module files included. */
function propertyBearingFiles(app: App): AppFile[] {
  return [...PROPERTY_BEARING_FILE_TYPES].flatMap((type) => app.ofType(type));
}

/**
 * The `modules/<name>/…` files an `app/modules/<name>/…` copy replaces on deploy. Counting both
 * would report the overwrite against the very file it exists to replace — the normal way to
 * change an installed module's property type.
 */
function shadowedOriginals(app: App): ReadonlySet<string> {
  return new Set(
    propertyBearingFiles(app)
      .filter((file) => file.isModuleOverwrite)
      .map((file) => file.moduleOriginalUri)
      .filter((uri): uri is string => uri !== undefined),
  );
}

function deployedPropertyFiles(app: App): AppFile[] {
  const shadowed = shadowedOriginals(app);
  return propertyBearingFiles(app).filter((file) => !shadowed.has(file.uri));
}
