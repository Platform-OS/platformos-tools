export * from './app';
export * from './documents-locator/DocumentsLocator';
export * from './translation-provider/TranslationProvider';
export * from './route-table';
export * from './AbstractFileSystem';
export * from './os-path';
export * from './path-utils';
export * from './object-scope';
export * from './frontmatter';
// Two neutral platformOS platform facts (no lint/offense use), which join to each
// other: the model table a GraphQL operation targets, and the `name:` a schema file
// declares. They live here beside the other structure/resolution facts (frontmatter,
// RouteTable, DocumentsLocator) because knowing them IS platformOS domain knowledge,
// and this package is where that knowledge lives.
//
// Reading them means reading YAML and GraphQL, which is why `js-yaml` and `graphql`
// are dependencies. That does not cross the boundary `app/package-boundaries.spec.ts`
// pins: both are browser-safe and neither is a workspace package, so `App` still sits
// below the parser stack and still takes its parsers by INJECTION — which is what lets
// the linter, the language server and the graph share one set of `AppFile`s. The
// GraphQL parser they inject is `parseGraphql` from right here, so a `.graphql` file is
// parsed once and every consumer reads the same document.
export * from './graphql';
export * from './schema-properties';
export * from './schema-table';
export * from './yaml-load-options';
export * from './yaml-line-breaks';
export * from './find-root';
