import { PROPERTY_BEARING_FILE_TYPES, SCHEMA_PROPERTY_TYPES } from '@platformos/platformos-common';
import { JSONNode, ObjectNode } from '../../jsonc/types';
import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { isError } from '../../utils';

/**
 * A schema property whose `type` the platform does not accept.
 *
 * Measured by a REAL deploy: `Attribute type \`not_a_real_type\` is not allowed`, which
 * fails the whole changeset. `--dry-run` accepts the same file — it returns before
 * `persist_slice!`, so the nested `CustomAttributeConverter` that validates the type never
 * runs — which is why this went unreported and was recorded as something the platform allows.
 *
 * Case-sensitive, matching the model's `inclusion:`: `type: String` is rejected too.
 */
export const InvalidSchemaPropertyType: YAMLCheckDefinition = {
  meta: {
    code: 'InvalidSchemaPropertyType',
    name: 'Invalid Schema Property Type',
    docs: {
      description:
        'Reports a schema property whose `type` is not one the platform accepts. The deploy converter rejects the whole changeset for an unknown type.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/invalid-schema-property-type',
    },
    type: SourceCodeType.YAML,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      // No tree to walk beyond the document itself, and the file's own AST already carries
      // offsets — matching `DuplicateYAMLKey`'s seam rather than re-parsing.
      async onCodePathStart(file) {
        if (!PROPERTY_BEARING_FILE_TYPES.has(context.fileType()!)) return;
        // An unparseable file belongs to `YAMLSyntaxError` alone.
        if (isError(file.ast)) return;

        for (const property of schemaProperties(file.ast)) {
          const type = propertyOf(property, 'type');
          if (type?.value.type !== 'Literal') continue;

          const declared = type.value.value;
          // A non-string, or a Liquid-interpolated value, is not ours to judge.
          if (typeof declared !== 'string' || declared.includes('{{')) continue;
          if ((SCHEMA_PROPERTY_TYPES as readonly string[]).includes(declared)) continue;

          context.report({
            message: `Invalid property type '${declared}'. Must be one of: ${SCHEMA_PROPERTY_TYPES.join(', ')}`,
            startIndex: type.value.loc.start.offset,
            endIndex: type.value.loc.end.offset,
          });
        }
      },
    };
  },
};

/**
 * Each entry of the document's `properties:` sequence.
 *
 * A SEQUENCE specifically: the mapping form is rejected on deploy, so a document using it is
 * broken for a reason this check does not own and has no properties worth reading.
 */
function schemaProperties(ast: JSONNode): ObjectNode[] {
  if (ast.type !== 'Object') return [];
  const properties = propertyOf(ast, 'properties');
  if (properties?.value.type !== 'Array') return [];

  return properties.value.children.filter((child): child is ObjectNode => child.type === 'Object');
}

function propertyOf(node: ObjectNode, name: string) {
  return node.children.find((child) => child.key.value === name);
}
