import {
  App as AppModel,
  GraphQLDocumentNode,
  Parser,
  Parsers,
  SourceCodeType,
} from '@platformos/platformos-common';
import { beforeEach, describe, expect, it } from 'vitest';

import { check as coreCheck, Config, Dependencies, Offense, sourceParsers } from './index';
import { GraphQLCheck } from './checks/graphql';
import { GraphQLVariablesCheck } from './checks/graphql-variables';
import { UnknownProperty } from './checks/unknown-property';
import { MockFileSystem } from './test/MockFileSystem';
import { createMockDependencies, mockRootUri } from './test/test-helper';

/**
 * A `.graphql` document is parsed ONCE per lint run — however many checks and call
 * sites read it — and parsed again only when its source changes.
 *
 * The parse belongs to the `AppFile`, which is why this is really a test that no
 * consumer has grown its own `parse(content)` back. Three of them read the same two
 * documents here: `GraphQLCheck` validates them, `GraphQLVariablesCheck` reads their
 * variables for three call sites, and `UnknownProperty`'s shape analyzer reads their
 * selection sets for the same three. Give any one of them a parse of its own and the
 * count below goes up — that is the sabotage this file is written to catch.
 *
 * A count alone would be blind to a consumer that calls the parser itself, so the
 * fixture makes the app's parse UNREPRODUCIBLE: every document's source carries a `%%`
 * that is not GraphQL, and the app's parser strips it while keeping the original as the
 * node's `content`. The app's document is therefore the only one that exists — parse
 * the file, the buffer or `ast.content` again and you get a syntax error instead, which
 * every assertion below would show.
 */
const SCHEMA = `
  type Query {
    records(filter: RecordFilter): RecordCollection
  }

  input RecordFilter {
    id: IdFilter
    table: TableFilter
  }

  input IdFilter { value: ID }
  input TableFilter { value: String }

  type RecordCollection { results: [Record] }
  type Record { id: ID, title: String }
`;

const QUERY_URI = `${mockRootUri}app/graphql/blog/find.graphql`;

/** Not GraphQL. Only the app's parser knows to drop it — see the counting parser. */
const UNPARSEABLE_MARKER = '%%';

const QUERY = `${UNPARSEABLE_MARKER}query find($id: ID!) {
  records(filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id title }
  }
}`;

/** The same operation with one variable renamed: a different parse, different offenses. */
const CHANGED_QUERY = QUERY.replace(/\$id/g, '$slug');

const page = (body: string) => `{% graphql result = 'blog/find', id: '1' %}\n${body}`;

const appDesc = {
  'app/graphql/blog/find.graphql': QUERY,
  // A second document, invalid against the schema, so `GraphQLCheck` is doing work
  // rather than passing by silence.
  'app/graphql/blog/broken.graphql': `${UNPARSEABLE_MARKER}{ unknownField }`,
  'app/views/pages/a.liquid': page('{{ result.records.results }}'),
  'app/views/pages/b.liquid': page('{{ result.records.results }}'),
  // The third call site passes an argument the operation does not declare and reads a
  // property the selection set does not select, so both of the checks that consume the
  // document have something to say on every run.
  'app/views/pages/c.liquid':
    "{% graphql result = 'blog/find', id: '1', nope: '1' %}\n{{ result.records.nope }}",
};

const BASELINE_OFFENSES = [
  'GraphQLCheck: Cannot query field "unknownField" on type "Query".',
  'GraphQLVariablesCheck: Unknown parameter nope passed to GraphQL call',
  "UnknownProperty: Unknown property 'nope' on 'result.records'.",
];

describe('a .graphql file is parsed once per run', () => {
  let graphqlParses: number;
  let app: AppModel;
  let run: () => Promise<Offense[]>;

  beforeEach(() => {
    graphqlParses = 0;

    const graphqlParser = sourceParsers[SourceCodeType.GraphQL] as Parser;
    const countingParsers: Parsers = {
      ...sourceParsers,
      [SourceCodeType.GraphQL]: (source, uri) => {
        graphqlParses++;
        // The parse the app hands out is not one any consumer could reproduce: the
        // marker is dropped here, and `content` keeps the original source — so a second
        // parse, of the file or of `ast.content`, yields a syntax error and no document.
        const parsed = graphqlParser(source.replace(UNPARSEABLE_MARKER, ''), uri);
        return { ...(parsed as GraphQLDocumentNode), content: source };
      },
    };

    const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appDesc });
    app = AppModel.fromSources(mockRootUri, appDesc, fs, countingParsers);

    const config: Config = {
      settings: {},
      checks: [GraphQLCheck, GraphQLVariablesCheck, UnknownProperty],
      rootUri: mockRootUri,
      onError: (error) => {
        throw error;
      },
    };

    const mockDependencies = createMockDependencies(fs, app);
    const dependencies: Dependencies = {
      ...mockDependencies,
      platformosDocset: {
        ...mockDependencies.platformosDocset,
        async graphQL() {
          return SCHEMA;
        },
      },
    };

    run = () => coreCheck(app, config, dependencies);
  });

  it('parses each document once, for three checks and three call sites', async () => {
    const offenses = await run();

    expect(graphqlParses).toBe(2); // the two `.graphql` files, once each
    expect(summarize(offenses)).toEqual(BASELINE_OFFENSES);
  });

  it('does not parse them again on a second run over an unchanged app', async () => {
    await run();
    await run();

    expect(graphqlParses).toBe(2);
  });

  it('parses a document again — and reports on the new content — after its source changes', async () => {
    await run();

    // The app now holds a version the filesystem does not: a consumer reading through
    // `fs` instead of the app would still see `$id` and report nothing.
    app.setSource(QUERY_URI, CHANGED_QUERY, 1);
    const offenses = await run();

    expect(graphqlParses).toBe(3);
    expect(summarize(offenses)).toEqual([
      'GraphQLCheck: Cannot query field "unknownField" on type "Query".',
      'GraphQLVariablesCheck: Required parameter slug must be passed to GraphQL call',
      'GraphQLVariablesCheck: Required parameter slug must be passed to GraphQL call',
      'GraphQLVariablesCheck: Required parameter slug must be passed to GraphQL call',
      'GraphQLVariablesCheck: Unknown parameter id passed to GraphQL call',
      'GraphQLVariablesCheck: Unknown parameter id passed to GraphQL call',
      'GraphQLVariablesCheck: Unknown parameter id passed to GraphQL call',
      'GraphQLVariablesCheck: Unknown parameter nope passed to GraphQL call',
      "UnknownProperty: Unknown property 'nope' on 'result.records'.",
    ]);
  });
});

/** Offenses as `check: message`, ordered, since the pipelines finish in no fixed order. */
function summarize(offenses: Offense[]): string[] {
  return offenses.map((offense) => `${offense.check}: ${offense.message}`).sort();
}
