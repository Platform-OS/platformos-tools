export * from './app';
export * from './documents-locator/DocumentsLocator';
export * from './translation-provider/TranslationProvider';
export * from './route-table';
export * from './AbstractFileSystem';
export * from './os-path';
export * from './path-utils';
export * from './object-scope';
export * from './frontmatter';
// A neutral platformOS platform fact (no lint/offense use): a schema file's declared
// `name:`. It lives here beside the other structure/resolution facts (frontmatter,
// RouteTable, DocumentsLocator) and is consumed by the graph, and it can live here
// because reading it needs only `js-yaml` — the YAML reader this package already owns.
//
// Its sibling `extractGraphqlTables` does NOT live here, and the reason is the boundary
// `app/package-boundaries.spec.ts` pins: it needs the `graphql` PARSER, and this package
// sits below the parser stack so that `App` can have its parsers INJECTED. That injection
// is the whole reason one set of `AppFile`s is shareable between the linter, the language
// server and the graph. It now lives in `platformos-check-common`, which already owns the
// GraphQL knowledge and the dependency, and which the graph already depends on.
export * from './schema-table';
export * from './yaml-load-options';
