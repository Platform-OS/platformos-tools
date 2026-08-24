import {
  App as AppModel,
  getFileType,
  GraphQLDocumentNode,
  Parser,
  Parsers,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { beforeEach, describe, expect, it } from 'vitest';

import { allChecks } from './checks';
import { GraphQLCheck } from './checks/graphql';
import { GraphQLVariablesCheck } from './checks/graphql-variables';
import { NestedGraphQLQuery } from './checks/nested-graphql-query';
import { UnknownProperty } from './checks/unknown-property';
import { CHECK_ERROR_CODE, check as coreCheck, Config, Dependencies, sourceParsers } from './index';
import * as path from './path';
import { check, getApp, MockFileSystem } from './test';
import { MockApp } from './test/MockApp';
import { createMockDependencies, mockRootUri } from './test/test-helper';
import { LiquidCheckDefinition, Offense, Severity, SourceCodeType } from './types';

const rootUri = path.normalize('file:/');
const uri = (relativePath: string) => path.join(rootUri, relativePath);

const PAGE = 'app/views/pages/index.liquid';
const OTHER_PAGE = 'app/views/pages/other.liquid';

describe('Unit: check() with the `only` option', () => {
  /**
   * An app where offenses exist in MORE THAN ONE file, and where the file under
   * test depends on the rest of the project: neither the missing partial nor the
   * missing translation key can be detected from the visited file alone.
   */
  const APP: MockApp = {
    [PAGE]: [
      `{% render 'does/not/exist' %}`,
      `{{ 'missing.translation.key' | t }}`,
      `<img src="/a.png">`,
    ].join('\n'),
    [OTHER_PAGE]: `<img src="/b.png">`,
    'app/views/partials/present.liquid': `{{ 'present.key' | t }}`,
    'app/translations/en.yml': `en:\n  present:\n    key: "Present"\n`,
  };

  /**
   * Offense ORDER is not part of `check()`'s contract — pipelines resolve
   * concurrently — so comparisons here are order-insensitive by construction.
   */
  const sorted = (offenses: Offense[]) =>
    [...offenses].sort((a, b) =>
      `${a.uri} ${a.check} ${a.start.index}`.localeCompare(`${b.uri} ${b.check} ${b.start.index}`),
    );

  const forFile = (offenses: Offense[], relativePath: string) =>
    offenses.filter((offense) => offense.uri === uri(relativePath));

  const checksIn = (offenses: Offense[]) => offenses.map((offense) => offense.check).sort();

  const checkOnly = (only: string[]) => check(APP, undefined, {}, {}, { only });

  it('returns exactly what the unrestricted run reports for that file, field for field', async () => {
    const everything = await check(APP);

    expect(sorted(await checkOnly([uri(PAGE)]))).toEqual(sorted(forFile(everything, PAGE)));
  });

  it('still detects cross-file problems in the visited file', async () => {
    expect(checksIn(await checkOnly([uri(PAGE)]))).toEqual([
      'ImgWidthAndHeight',
      'MissingPartial',
      'TranslationKeyExists',
    ]);
  });

  it('reports nothing for a file it was told not to visit, even though that file does offend', async () => {
    const everything = await check(APP);
    const onlyThePage = await checkOnly([uri(PAGE)]);

    // Guard: the fixture only proves something if the skipped file really offends.
    expect(checksIn(forFile(everything, OTHER_PAGE))).toEqual(['ImgWidthAndHeight']);
    expect(forFile(onlyThePage, OTHER_PAGE)).toEqual([]);
  });

  it('can visit several named files at once', async () => {
    const everything = await check(APP);
    const twoFiles = await checkOnly([uri(PAGE), uri(OTHER_PAGE)]);

    expect(sorted(twoFiles)).toEqual(
      sorted([...forFile(everything, PAGE), ...forFile(everything, OTHER_PAGE)]),
    );
  });

  it('visits nothing when told to visit an empty list of files', async () => {
    // `[]` is taken literally rather than meaning "everything" — a caller that
    // computes the list must decide for itself what an empty result means.
    expect(await checkOnly([])).toEqual([]);
  });

  it('visits everything when `only` is explicitly undefined, which `[]` must not do', async () => {
    // The other half of the rule above. `undefined` and `[]` are the two ways a
    // caller can fail to name a file, and they mean opposite things. The guard
    // must key on absence, not emptiness: an `!only?.length` style test collapses
    // them and silently lints the WHOLE project when asked for nothing.
    const everything = await check(APP);

    expect(sorted(await check(APP, undefined, {}, {}, { only: undefined }))).toEqual(
      sorted(everything),
    );
    expect(everything).not.toEqual([]);
  });

  it('returns no offenses when told to visit a file that is not part of the app', async () => {
    expect(await checkOnly([uri('app/views/pages/ghost.liquid')])).toEqual([]);
  });

  it('attributes every offense to the file it was found in — the invariant `only` relies on', async () => {
    const everything = await check(APP);
    const knownUris = Object.keys(APP).map(uri);

    // No offense may carry a uri outside the app. That every offense belongs to the
    // file that produced it is covered by the per-file equality tests above.
    expect(everything.filter((offense) => !knownUris.includes(offense.uri))).toEqual([]);
  });
});

describe('Unit: a check that throws part-way through a file', () => {
  const APP = { [PAGE]: `{% assign a = 1 %}{% assign b = 2 %}` };

  /**
   * A check that reports one offense and then dies, which is what a real one does when
   * it reads a field off markup the parser could not structure. Before the failure was
   * surfaced, the run kept the first offense, lost the second, and said nothing — a
   * shrunken offense set that reads exactly like a clean file.
   */
  const Exploding: LiquidCheckDefinition = {
    meta: {
      code: 'Exploding',
      name: 'Throws part-way through a file',
      docs: { description: 'Test double.', recommended: false },
      type: SourceCodeType.LiquidHtml,
      severity: Severity.WARNING,
      schema: {},
      targets: [],
    },

    create(context) {
      let seen = 0;
      return {
        async LiquidTag(node) {
          seen += 1;
          if (seen > 1) throw new Error('the analyzer died');
          context.report({
            message: 'found before the throw',
            startIndex: node.position.start,
            endIndex: node.position.end,
          });
        },
      };
    },
  };

  const runExploding = (onError?: (error: Error) => void): Promise<Offense[]> => {
    const fs = new MockFileSystem({ '.platformos-check.yml': '', ...APP });
    return coreCheck(
      getApp(APP, fs),
      { settings: {}, checks: [Exploding], rootUri, onError },
      { fs },
    );
  };

  it('surfaces the failure as an offense, keeping what the check reported before it', async () => {
    expect(await runExploding()).toEqual([
      {
        type: SourceCodeType.LiquidHtml,
        check: 'Exploding',
        message: 'found before the throw',
        uri: uri(PAGE),
        severity: Severity.WARNING,
        start: { index: 0, line: 0, character: 0 },
        end: { index: 18, line: 0, character: 18 },
        fix: undefined,
        suggest: undefined,
      },
      {
        type: SourceCodeType.LiquidHtml,
        check: CHECK_ERROR_CODE,
        message: 'Exploding failed on this file and did not finish checking it: the analyzer died',
        uri: uri(PAGE),
        severity: Severity.ERROR,
        start: { index: 0, line: 0, character: 0 },
        end: { index: 0, line: 0, character: 0 },
      },
    ]);
  });

  it('still hands the error to a host that installed onError', async () => {
    const seen: string[] = [];
    const offenses = await runExploding((error) => seen.push(error.message));

    expect(seen).toEqual(['the analyzer died']);
    expect(offenses.map((offense) => offense.check)).toEqual(['Exploding', CHECK_ERROR_CODE]);
  });
});

/**
 * `app/config.yml` and `app/user.yml` are classified now, which means the linter
 * VISITS them for the first time — they are `isKnownYAMLFile`, so check-node's glob
 * collects them and `check()` runs every YAML check against them.
 */
describe('the fixed-path config files', () => {
  const app = {
    'app/config.yml': ['theme_search_paths:', '  - theme/dress', 'foo: <b>bar</b>', ''].join('\n'),
    'app/user.yml': ['properties:', '  - name: first_name', '    type: string', ''].join('\n'),
    'app/translations/en.yml': `en:
  hello: Hello
`,
  };

  it('are classified, and are YAML sources the linter loads', () => {
    expect(getFileType('file:///project/app/config.yml', 'file:///project')).toBe(
      PlatformOSFileType.InstanceConfig,
    );
    expect(getFileType('file:///project/app/user.yml', 'file:///project')).toBe(
      PlatformOSFileType.UserSchema,
    );
  });

  it('attract no offenses from any check', async () => {
    // The URIs as `check()` actually reports them. Spelled `file:/app/...` this filter
    // matched NOTHING, so the assertion below passed without looking at anything — the
    // test that follows is what exposed it.
    const configUris = ['file:///app/config.yml', 'file:///app/user.yml'];

    const offenses = await check(app, allChecks);

    expect(
      offenses
        .filter((offense) => configUris.includes(offense.uri))
        .map((offense) => `${offense.check} on ${offense.uri}: ${offense.message}`),
    ).toEqual([]);
  });

  it('has every YAML check guarding on the file type, not on a path substring', () => {
    // A `/translations/` substring test would also have skipped these two by luck.
    // Guarding on the type is what makes it deliberate — and what makes it survive a
    // translations directory alias being added to FILE_TYPE_DIRS.
    const yamlChecks = allChecks.filter((def) => def.meta.type === SourceCodeType.YAML);

    expect(yamlChecks.map((def) => def.meta.code).sort()).toEqual([
      'DuplicateYAMLKey',
      // Guards on PROPERTY_BEARING_FILE_TYPES — the four converters that share
      // `CustomAttributeConverter` — rather than on an `app/schema/` path test.
      'InvalidSchemaPropertyType',
      'MatchingTranslations',
      'ValidHTMLTranslation',
      'YAMLSyntaxError',
    ]);
  });

  /**
   * The exception, measured. The enumeration above only records the INTENT that these two
   * checks are type-agnostic; this proves it for the one whose finding is easy to author,
   * on the file type that was classified last and is least likely to have been considered.
   */
  it('reports a duplicated key in a config file, not only in a translation file', async () => {
    const offenses = await check(
      {
        'app/config.yml': `theme_search_paths:
  - theme/dress
foo: one
foo: two
`,
      },
      allChecks,
    );

    expect(offenses.map((offense) => ({ check: offense.check, uri: offense.uri }))).toEqual([
      { check: 'DuplicateYAMLKey', uri: 'file:///app/config.yml' },
    ]);
  });
});

/**
 * A `.graphql` document is parsed ONCE per lint run — however many checks and call sites read
 * it — and parsed again only when its source changes.
 */
describe('a .graphql file is parsed once per run', () => {
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

  /** Offenses as `check: message`, ordered, since the pipelines finish in no fixed order. */
  const summarize = (offenses: Offense[]): string[] =>
    offenses.map((offense) => `${offense.check}: ${offense.message}`).sort();

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

/**
 * The same discipline for a LIQUID partial, and for the one check that follows a call
 * chain across files: `NestedGraphQLQuery` walks `{% function %}`/`{% render %}` targets
 * looking for a `{% graphql %}` inside them.
 */
describe('a partial in a call chain is parsed once, by the app', () => {
  const MARKER = 'ZZ_GRAPHQL_ZZ';
  const PAGE_WITH_LOOP = 'app/views/pages/loop.liquid';
  const SECOND_PAGE_WITH_LOOP = 'app/views/pages/loop-again.liquid';

  const appDesc: MockApp = {
    [PAGE_WITH_LOOP]: `{% for item in items %}{% function res = 'get_data' %}{% endfor %}`,
    // A second call site in a different file: the partial is parsed once for BOTH.
    [SECOND_PAGE_WITH_LOOP]: `{% for item in items %}{% function res = 'get_data' %}{% endfor %}`,
    'app/views/partials/get_data.liquid': MARKER,
  };

  let liquidParses: string[];
  let run: () => Promise<Offense[]>;

  beforeEach(() => {
    liquidParses = [];

    const liquidParser = sourceParsers[SourceCodeType.LiquidHtml] as Parser;
    const countingParsers: Parsers = {
      ...sourceParsers,
      [SourceCodeType.LiquidHtml]: (source, uri) => {
        liquidParses.push(uri);
        return liquidParser(source.replace(MARKER, `{% graphql result = 'x' %}`), uri);
      },
    };

    const fs = new MockFileSystem({ '.platformos-check.yml': '', ...appDesc });
    const app = AppModel.fromSources(mockRootUri, appDesc, fs, countingParsers);

    run = () =>
      coreCheck(
        app,
        {
          settings: {},
          checks: [NestedGraphQLQuery],
          rootUri: mockRootUri,
          onError: (error) => {
            throw error;
          },
        },
        createMockDependencies(fs, app),
      );
  });

  it('reports through the app’s parse, and parses the partial once for two call sites', async () => {
    const offenses = await run();

    expect(offenses.map((offense) => `${offense.check}: ${offense.message}`).sort()).toEqual([
      "NestedGraphQLQuery: N+1 pattern: {% function 'get_data' %} inside a {% for %} loop " +
        'transitively calls a GraphQL query (get_data). Move the query before the loop and ' +
        'pass data as a variable.',
      "NestedGraphQLQuery: N+1 pattern: {% function 'get_data' %} inside a {% for %} loop " +
        'transitively calls a GraphQL query (get_data). Move the query before the loop and ' +
        'pass data as a variable.',
    ]);
    expect(liquidParses.filter((uri) => uri.endsWith('get_data.liquid'))).toEqual([
      `${mockRootUri}app/views/partials/get_data.liquid`,
    ]);
  });
});
