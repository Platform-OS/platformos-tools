import {
  LiquidHtmlNode,
  LiquidTag,
  LiquidVariableLookup,
  NodeTypes,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isError } from '../../utils';
import { lookupPropertyPath } from './property-shape';
import {
  AnalyzableFile,
  ShapeAnalyzerDeps,
  buildLookupPath,
  createShapeAnalyzer,
} from './shape-analysis';

export const UnknownProperty: LiquidCheckDefinition = {
  meta: {
    code: 'UnknownProperty',
    name: 'Unknown property access',
    docs: {
      description:
        'Reports errors when accessing properties that do not exist on variables with known structure.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const ast = context.file.ast;
    if (isError(ast)) return {};

    const locator = new DocumentsLocator(context.fs, context.app);
    const rootUri = URI.parse(context.config.rootUri);

    let graphqlSchema: string | undefined;
    let graphqlSchemaLoaded = false;
    const getSchema = async (): Promise<string | undefined> => {
      if (!graphqlSchemaLoaded) {
        graphqlSchema = (await context.platformosDocset?.graphQL()) ?? undefined;
        graphqlSchemaLoaded = true;
      }
      return graphqlSchema;
    };

    /**
     * A file's current content, preferring the app's copy — an editor buffer beats
     * what is on disk, and the app has already read most of these once.
     */
    const readContent = async (uri: string): Promise<string | undefined> => {
      const file = context.app.get(uri);
      if (file) {
        await file.load();
        return file.loadedSource;
      }
      try {
        return await context.fs.readFile(uri);
      } catch {
        return undefined;
      }
    };

    /**
     * The partial a `{% function %}` calls, with its parse. The app's `AppFile` owns
     * the parse when it has one, so a partial called from thirty pages is parsed once
     * per run rather than once per call site.
     */
    const readPartial = async (name: string): Promise<AnalyzableFile | undefined> => {
      const uri = await locator.locate(rootUri, 'function', name);
      if (!uri) return undefined;

      const file = context.app.get(uri);
      if (file) {
        await file.load();
        const parsed = file.ast;
        if (file.loadedSource === undefined || !isLiquidDocument(parsed)) return undefined;
        return { uri, source: file.loadedSource, ast: parsed };
      }

      const source = await readContent(uri);
      if (source === undefined) return undefined;
      try {
        return { uri, source, ast: toLiquidHtmlAST(source) };
      } catch {
        return undefined;
      }
    };

    const deps: ShapeAnalyzerDeps = {
      async readGraphQL(name: string) {
        const uri = await locator.locate(rootUri, 'graphql', name);
        if (!uri) return undefined;
        const content = await readContent(uri);
        return content === undefined ? undefined : { uri, content };
      },
      readPartial,
      readContent,
      getSchema,
    };

    const analyzer = createShapeAnalyzer(deps, { callChain: new Set([context.file.uri]) });

    return {
      async LiquidTag(node: LiquidTag, ancestors: LiquidHtmlNode[]) {
        await analyzer.handleLiquidTag(node, ancestors);
      },

      async VariableLookup(node: LiquidVariableLookup, ancestors: LiquidHtmlNode[]) {
        analyzer.handleVariableLookup(node, ancestors);
      },

      async onCodePathEnd() {
        for (const lookup of analyzer.lookups) {
          if (!lookup.name) continue;

          // No known shape - don't validate (could be dynamic/external)
          const shape = analyzer.shapeAt(lookup.name, lookup.position.start);
          if (!shape) continue;

          // A dynamic path (`a[key]`) can't be validated
          const path = buildLookupPath(lookup.lookups);
          if (!path) continue;

          const result = lookupPropertyPath(shape, path);
          if (result.errorAt === undefined) continue;

          const accessPath =
            result.errorAt > 0
              ? `${lookup.name}.${path.slice(0, result.errorAt).join('.')}`
              : lookup.name;
          const invalidLookup = lookup.lookups[result.errorAt];

          if (result.error === 'unknown_property') {
            context.report({
              message: `Unknown property '${path[result.errorAt]}' on '${accessPath}'.`,
              startIndex: invalidLookup.position.start,
              endIndex: invalidLookup.position.end,
            });
          } else if (result.error === 'primitive_access') {
            context.report({
              message: `Cannot access property '${
                path[result.errorAt]
              }' on primitive value '${accessPath}'.`,
              startIndex: invalidLookup.position.start,
              endIndex: invalidLookup.position.end,
            });
          }
        }
      },
    };
  },
};

function isLiquidDocument(ast: unknown): ast is LiquidHtmlNode {
  return (
    typeof ast === 'object' &&
    ast !== null &&
    (ast as { type?: unknown }).type === NodeTypes.Document
  );
}
