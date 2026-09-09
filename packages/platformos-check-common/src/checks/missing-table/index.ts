import {
  PlatformOSFileType,
  extractGraphqlTableReferences,
  extractSchemaTable,
  parameterizedTableName,
} from '@platformos/platformos-common';
import { GraphQLCheckDefinition, SchemaProp, Severity, SourceCodeType } from '../../types';

const schema = {
  ignoreMissing: SchemaProp.array(SchemaProp.string(), []),
};

export const MissingTable: GraphQLCheckDefinition<typeof schema> = {
  meta: {
    code: 'MissingTable',
    name: 'Avoid querying missing tables',
    docs: {
      description: 'Reports a GraphQL operation naming a model table that no schema file declares.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-table',
    },
    type: SourceCodeType.GraphQL,
    severity: Severity.ERROR,
    schema,
    targets: [],
  },

  create(context) {
    let declared: Promise<Set<string>> | undefined;

    /**
     * Every table the project declares, which is the COMPLETE vocabulary: measured against a
     * live instance, `admin_tables` holds only what deployed schemas created, so there are no
     * platform-provided names to allow for. Module schemas are included because
     * `PlatformOSFileType.Table` already covers the module directories.
     */
    async function declaredTables(): Promise<Set<string>> {
      declared ??= (async () => {
        const names = new Set<string>();
        for (const file of context.app.ofType(PlatformOSFileType.Table)) {
          await file.load();
          const declared = extractSchemaTable(file.source);
          // The YAML `name:` is not the table: a schema in a module is queried as
          // `modules/<module>/<name>`. Measured on real projects, where every module table
          // was reported missing until this prefix was applied.
          if (declared) names.add(parameterizedTableName(declared, file.moduleName));
        }
        return names;
      })();

      return declared;
    }

    return {
      async onCodePathEnd(node) {
        const references = extractGraphqlTableReferences(node.ast);
        if (references.length === 0) return;

        const tables = await declaredTables();

        // A project with no schema at all cannot be told apart from one whose schemas this run
        // never saw, and reporting every table on the second would be a wall of false positives
        // in exchange for nothing on the first — a project with no models has nothing to query.
        if (tables.size === 0) return;

        const ignored = context.settings.ignoreMissing ?? [];

        for (const reference of references) {
          if (tables.has(reference.table) || ignored.includes(reference.table)) continue;

          context.report({
            message: `'${reference.table}' is not declared by any schema file`,
            startIndex: reference.position?.start ?? 0,
            endIndex: reference.position?.end ?? 0,
          });
        }
      },
    };
  },
};
