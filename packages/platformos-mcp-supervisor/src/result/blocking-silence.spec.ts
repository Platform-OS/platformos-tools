import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { path as pathUtils } from '@platformos/platformos-check-common';
import { AppCache } from '@platformos/platformos-check-node';

import { BLOCKING_CHECKS } from './blocking.js';
import type { ValidateCodeResult } from './types.js';
import type { SupervisorContext } from '../context.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import { runValidateCode } from '../transport/validate-code.js';

/**
 * Every member of `BLOCKING_CHECKS` must stay SILENT on input the platform accepts.
 *
 * WHY THIS FILE EXISTS. `blocking-emission.spec.ts` is its mirror and proves each
 * member CAN block. Between them they state the whole promise, and until this file
 * existed only half of it was defended: every guard in this repository asserted that
 * checks fire, and none asserted where a check must not.
 *
 * That gap shipped a false block. `yaml` defaults `uniqueKeys` to `true`, so a
 * duplicated key — which `pos-cli deploy --dry-run` accepts — became
 * `must_fix_before_write: true`, while the check's own docstring and the server's
 * agent-facing instructions both stated, from correct measurement, that duplicates are
 * not reported. Two documents said so. Nothing could fail. The suite stayed green for
 * the entire time the code did the opposite.
 *
 * THE ASYMMETRY THAT JUSTIFIES THE COST. A missed detection returns a broken file the
 * agent finds out about later. A FALSE BLOCK is an unappealable refusal: the agent
 * cannot write correct code, and there is no override. Across four evaluation rounds
 * the false-block count never moved, and every one was found by an external evaluator
 * driving a live instance — never by this suite. This file is how that stops being
 * true, because a false block becomes a CI failure rather than an eval finding.
 *
 * WHAT MAKES A FIXTURE ADMISSIBLE. Only input whose validity was ESTABLISHED. Every
 * entry records the oracle that settled it (see {@link Oracle}), because a fixture
 * asserted to be valid on nothing but its author's confidence pins a guess. Round 4
 * recorded three of its own fixture errors, two of them "invalid" YAML that was
 * actually valid; writing this file produced a fourth — see `GraphQLCheck` below.
 *
 * WHY THE WHOLE PIPELINE. Same reason as the emission suite: silence has two
 * independent causes, the check declining to report and the supervisor never routing
 * the file to it, and only the first is interesting here. Running end to end means a
 * fixture that goes quiet because routing broke fails in the emission suite instead of
 * passing quietly in this one.
 *
 * CONTROLS LIVE IN THE EMISSION SUITE, deliberately not duplicated here. An assertion
 * that nothing was reported is satisfied equally well by a check that stopped working,
 * so silence is only meaningful while something else proves the check still fires.
 * That is exactly what `blocking-emission.spec.ts` asserts, for every member, from a
 * real buffer. The single exception is the YAML control below, kept because
 * suppressing `DUPLICATE_KEY` is the specific edit that could widen into hiding a real
 * parse failure.
 */

/**
 * What established that a fixture is valid input. Never a guess, and never "it looks
 * fine" — each value names a thing that was actually run.
 */
type Oracle =
  /** `pos-cli deploy --dry-run` accepted this shape. Round-4 evaluation, O1c. */
  | 'dry-run'
  /** Executed through `liquid_exec` and rendered. Round-4 evaluation, O1a. */
  | 'runtime'
  /**
   * Follows from data GENERATED from the runtime: `filter-arity.ts` (read out of a
   * live instance's own complaints) and `undocumented-filters.ts`. Reading those is
   * reading a measurement, not an opinion.
   */
  | 'generated-data'
  /**
   * Valid because the thing it references exists in the fixture project — the partial
   * is written to disk, the operation declares the variable being passed, the layout
   * outputs `content_for_layout`. Nothing external is being claimed.
   */
  | 'by-construction'
  /** Valid against the project's GraphQL schema, which the check validates against. */
  | 'schema';

interface SilenceFixture {
  /** Names the shape, so a failure says which one. */
  name: string;
  /** Files written to the temp project before the call. */
  project?: Record<string, string>;
  filePath: string;
  content: string;
  oracle: Oracle;
}

const PAGE = 'app/views/pages/index.liquid';
const SCHEMA = 'app/schema/thing.yml';
const TRANSLATIONS = 'app/translations/en.yml';

/** Nesting deep enough to be unusual, shallow enough to be a real file. */
const deeplyNested = (levels: number): string => {
  let out = '';
  for (let index = 0; index < levels; index++) out += `${'  '.repeat(index)}k${index}:\n`;
  return `${out}${'  '.repeat(levels)}leaf: 1\n`;
};

/**
 * Valid-but-unusual YAML, imported from the round-4 evaluation rather than re-derived.
 *
 * That round deployed 52 shapes individually through `--dry-run` and the converter
 * accepted 50; the two it refused are the duplicate-key case that TASK-33 fixed, and
 * they are included here for that reason. Re-deriving this corpus would mean either
 * re-running a live instance or guessing, and the guess is what this file exists to
 * prevent.
 */
const VALID_YAML: Record<string, string> = {
  anchor_and_alias: 'base: &b\n  a: 1\nother: *b\n',
  merge_key: 'base: &b\n  a: 1\nchild:\n  <<: *b\n  c: 2\n',
  merge_key_multi_source: 'a: &a\n  x: 1\nb: &b\n  y: 2\nc:\n  <<: [*a, *b]\n',
  block_scalar_literal: 'name: |\n  line one\n  line two\n',
  block_scalar_folded: 'name: >\n  folded text here\n',
  block_scalar_strip: 'name: |-\n  no trailing newline\n',
  block_scalar_keep: 'name: |+\n  keep\n\n',
  block_scalar_explicit_indent: 'name: |2\n   two space indent\n',
  explicit_tags: 'a: !!str 5\nb: !!int "7"\nc: !!seq [1, 2]\n',
  custom_tag: 'a: !mytag foo\n',
  quoted_scalar_with_colon: 'a: "x: y"\n',
  quoted_scalar_with_hash: "a: 'c # d'\n",
  quoted_scalar_with_tab: 'a: "tab\there"\n',
  empty_document: '',
  comments_only: '# nothing here\n',
  byte_order_mark: '\uFEFFname: car\n',
  crlf_line_endings: 'name: car\r\nother: 1\r\n',
  document_start_marker: '---\nname: car\n',
  document_end_marker: 'name: car\n...\n',
  multi_document: 'name: a\n---\nname: b\n',
  bare_scalar: 'just a string\n',
  top_level_sequence: '- 1\n- 2\n',
  deep_nesting: deeplyNested(60),
  very_long_line: `name: ${'x'.repeat(20000)}\n`,
  non_ascii_keys: 'zażółć: gęślą\nключ: значение\n',
  emoji_key_and_value: '"🎉": party\nvalue: "🚀"\n',
  yaml_directive: '%YAML 1.2\n---\nname: car\n',
  complex_key: '? [a, b]\n: value\n',
  flow_collections: 'a: {b: 1, c: [1, 2]}\n',
  infinity_and_nan: 'a: .inf\nb: -.inf\nc: .nan\n',
  octal_and_hex: 'a: 0o14\nb: 0x1F\n',
  timestamps: 'a: 2026-01-01\nb: 2026-01-01T12:00:00Z\n',
  empty_values: 'a:\nb:\n',
  explicit_nulls: 'a: ~\nb: null\n',
  duplicate_key_top_level: 'name: car\nname: van\n',
  duplicate_key_nested: 'name: car\nproperties:\n  make: ford\n  make: audi\n',
};

/** Every shape, in a model schema and in a translation file. */
const yamlFixtures = (): SilenceFixture[] =>
  Object.entries(VALID_YAML).flatMap(([name, content]) => [
    { name, filePath: SCHEMA, content, oracle: 'dry-run' as const },
    { name: `${name} (translations)`, filePath: TRANSLATIONS, content, oracle: 'dry-run' as const },
  ]);

const EXISTING_PARTIALS = {
  'app/views/partials/card.liquid': 'card body\n',
  'app/lib/helper.liquid': 'helper body\n',
};

const DOCUMENTED_PARTIAL = {
  'app/views/partials/card.liquid':
    '{% doc %}\n  @param title {string} Title\n{% enddoc %}\n{{ title }}\n',
};

const GRAPHQL_OPERATION = {
  'app/graphql/get_thing.graphql':
    'query get_thing($id: ID!) { records(per_page: 10) { results { id } } }\n',
};

/**
 * Keyed by blocking check. The keys are pinned against `BLOCKING_CHECKS` below, so a
 * member added without must-stay-silent coverage fails here rather than shipping with
 * only half its promise defended.
 */
const STAYS_SILENT: Record<string, SilenceFixture[]> = {
  YAMLSyntaxError: yamlFixtures(),

  LiquidHTMLSyntaxError: [
    // Liquid the parser must accept. `by-construction` because the claim is only that
    // these parse — the evaluations render pages built from exactly these constructs,
    // but no single shape here was deployed on its own.
    {
      name: 'if block',
      filePath: PAGE,
      content: '{% if true %}x{% endif %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'whitespace control',
      filePath: PAGE,
      content: '{%- if true -%}x{%- endif -%}\n',
      oracle: 'by-construction',
    },
    {
      name: 'liquid tag',
      filePath: PAGE,
      content: '{% liquid\n  assign a = 1\n  echo a\n%}\n',
      oracle: 'by-construction',
    },
    {
      name: 'raw block',
      filePath: PAGE,
      content: '{% raw %}{{ not_liquid }}{% endraw %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'case block',
      filePath: PAGE,
      content: '{% assign x = 1 %}{% case x %}{% when 1 %}a{% else %}b{% endcase %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'for over a range',
      filePath: PAGE,
      content: '{% for i in (1..3) %}{{ i }}{% endfor %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'liquid inside an html attribute',
      filePath: PAGE,
      content: '<div data-x="{{ 1 }}">{{ 2 }}</div>\n',
      oracle: 'by-construction',
    },
    {
      name: 'comment block',
      filePath: PAGE,
      content: '{% comment %}hi{% endcomment %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'nested tags',
      filePath: PAGE,
      content: '{% if true %}{% for i in (1..2) %}{{ i }}{% endfor %}{% endif %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'filter chain',
      filePath: PAGE,
      content: "{{ 'a' | upcase | downcase }}\n",
      oracle: 'generated-data',
    },
  ],

  MissingPartial: [
    {
      name: 'render a partial that exists',
      project: EXISTING_PARTIALS,
      filePath: PAGE,
      content: "{% render 'card' %}\n",
      oracle: 'by-construction',
    },
    {
      name: 'function against app/lib',
      project: EXISTING_PARTIALS,
      filePath: PAGE,
      content: "{% function res = 'helper' %}{{ res }}\n",
      oracle: 'by-construction',
    },
  ],

  UnknownFilter: [
    // The vocabulary is generated data, so a documented filter is valid by
    // measurement rather than by recognition.
    {
      name: 'documented filters',
      filePath: PAGE,
      content: "{{ 'a' | upcase }}{{ 'B' | downcase }}{{ 1 | plus: 2 }}\n",
      oracle: 'generated-data',
    },
    // `undocumented-filters.ts` exists because the docset omits filters the runtime
    // accepts. Reporting one of those is the false block that list prevents, and this
    // is the assertion that keeps it load-bearing.
    {
      name: 'undocumented but valid: sum',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | sum }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'undocumented but valid: where',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | where: 'k', 'v' }}\n",
      oracle: 'generated-data',
    },
  ],

  FilterArity: [
    // Argument counts the measured table permits, at both ends of a range.
    {
      name: 'exactly the minimum',
      filePath: PAGE,
      content: "{{ 'a' | upcase }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'exactly two',
      filePath: PAGE,
      content: "{{ 'a' | append: 'b' }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'inside a range',
      filePath: PAGE,
      content: "{{ 'a' | default: 'd' }}\n",
      oracle: 'generated-data',
    },
    // `array_map` is one of four filters the generator could not determine and left
    // ABSENT rather than guessed. A filter with no measured arity must produce
    // nothing, whatever it is passed — that is what stops a data gap refusing working
    // code, and it is the property the check was admitted to the blocking set on.
    {
      name: 'a filter with no measured arity',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | array_map: 'k' }}\n",
      oracle: 'generated-data',
    },
  ],

  JsonLiteralQuoteStyle: [
    {
      name: 'double-quoted object literal',
      filePath: PAGE,
      content: '{% assign o = {"k": "v"} %}{{ o }}\n',
      oracle: 'dry-run',
    },
    {
      name: 'double-quoted array literal',
      filePath: PAGE,
      content: '{% assign a = ["x", "y"] %}{{ a }}\n',
      oracle: 'dry-run',
    },
    // Single quotes are only a defect INSIDE a JSON literal. An ordinary
    // single-quoted string is the common case and must never be touched.
    {
      name: 'an ordinary single-quoted string',
      filePath: PAGE,
      content: "{% assign s = 'plain' %}{{ s }}\n",
      oracle: 'dry-run',
    },
  ],

  GraphQLCheck: [
    // A FIXTURE ERROR WORTH RECORDING. Both of these began as
    // `records { results { id } }`, which I believed valid; the schema requires
    // `per_page`, so the check reported them and the "silence" fixtures were simply
    // wrong. The probe caught it before it became an assertion. This is the same shape
    // as the eval's own fixture errors: an observation about my input read as an
    // observation about the tool.
    {
      name: 'valid query with a declared variable',
      filePath: 'app/graphql/get_thing.graphql',
      content:
        'query get_thing($per_page: Int!) { records(per_page: $per_page) { results { id } } }\n',
      oracle: 'schema',
    },
    {
      name: 'valid query with no variables',
      filePath: 'app/graphql/plain.graphql',
      content: 'query plain { records(per_page: 10) { results { id } } }\n',
      oracle: 'schema',
    },
  ],

  GraphQLVariablesCheck: [
    {
      name: 'passes the declared variable',
      project: GRAPHQL_OPERATION,
      filePath: PAGE,
      content: "{% graphql g = 'get_thing', id: 1 %}{{ g }}\n",
      oracle: 'by-construction',
    },
  ],

  InvalidHashAssignTarget: [
    // From the round-4 structural set: 31 cases, zero false blocks, each run in both
    // tag spacings. These are the shapes the runtime ACCEPTS — a Hash takes a key, an
    // Array takes an index — which is exactly the distinction the check models.
    {
      name: 'hash with a key',
      filePath: PAGE,
      content: "{% assign h = '{}' | parse_json %}\n{% hash_assign h['k'] = 'v' %}\n",
      oracle: 'runtime',
    },
    {
      name: 'array with an index',
      filePath: PAGE,
      content: "{% assign a = '1,2' | split: ',' %}\n{% hash_assign a[0] = 'v' %}\n",
      oracle: 'runtime',
    },
    // A variable subscript cannot be resolved statically, so the accessor is unknown
    // and the check must decline rather than guess.
    {
      name: 'variable subscript',
      filePath: PAGE,
      content:
        "{% assign h = '{}' | parse_json %}\n{% assign k = 'a' %}\n{% hash_assign h[k] = 'v' %}\n",
      oracle: 'runtime',
    },
    // Never assigned in this file. It raises at runtime HERE, but in a partial the
    // same variable legitimately arrives as a render argument, so silence is the
    // deliberate reading. Pinned so it is not "fixed" by accident.
    {
      name: 'target never assigned in this file',
      filePath: PAGE,
      content: "{% hash_assign x['k'] = 'v' %}\n",
      oracle: 'by-construction',
    },
  ],

  MissingRenderPartialArguments: [
    {
      name: 'passes the required parameter',
      project: DOCUMENTED_PARTIAL,
      filePath: PAGE,
      content: "{% render 'card', title: 'x' %}\n",
      oracle: 'by-construction',
    },
  ],

  MissingContentForLayout: [
    {
      name: 'layout outputs content_for_layout',
      filePath: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>\n',
      oracle: 'by-construction',
    },
  ],
};

/**
 * Inter-tag whitespace, varied — the same axis `blocking-emission.spec.ts` varies, for
 * the same reason and with the same transformation.
 *
 * It matters more here than there. The defect that motivated it was a check going
 * SILENT when two tags abutted, and this file is made entirely of assertions that
 * something stays silent. A fixture that is quiet for the wrong reason would pass
 * every assertion above; running both spacings is what distinguishes "correctly
 * silent" from "accidentally blind".
 */
const TAGS_APART = /%\}\s+\{%/g;
const TAGS_TOGETHER = /%\}\{%/g;

function adjacencyVariants(content: string): string[] {
  return [
    ...new Set([
      content,
      content.replace(TAGS_APART, '%}{%'),
      content.replace(TAGS_TOGETHER, '%}\n{%'),
    ]),
  ];
}

describe('Integration: every blocking check stays silent on input the platform accepts', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-silence-'));
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const write = (files: Record<string, string> = {}) => {
    for (const [relativePath, source] of Object.entries(files)) {
      const absolute = join(projectDir, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, source, 'utf8');
    }
  };

  const validate = async (filePath: string, content: string): Promise<ValidateCodeResult> => {
    const ctx: SupervisorContext = {
      projectDir,
      graphCache: new GraphCache({ rootUri: pathUtils.toUri(projectDir) }),
      appCache: new AppCache(),
      log: () => {},
    };
    return (await runValidateCode(ctx, { file_path: filePath, content })) as ValidateCodeResult;
  };

  /**
   * What a fixture must produce. `blocked` covers the whole gate rather than the one
   * code, so a fixture that trips a DIFFERENT blocking check fails too — which is
   * correct, because such a fixture is not valid input after all.
   */
  const observe = async (code: string, fixture: SilenceFixture) => {
    write(fixture.project);
    const result = await validate(fixture.filePath, fixture.content);
    const everyDiagnostic = [...result.errors, ...result.warnings, ...result.infos];
    return {
      name: fixture.name,
      blocked: result.must_fix_before_write,
      fromCheck: everyDiagnostic
        .filter((diagnostic) => diagnostic.check === code)
        .map(({ check, message }) => `${check}: ${message}`),
    };
  };

  const silent = (fixture: SilenceFixture) => ({
    name: fixture.name,
    blocked: false,
    fromCheck: [] as string[],
  });

  it('has must-stay-silent coverage for every member of BLOCKING_CHECKS', () => {
    // The exhaustiveness guard, and the reason this file is more than a collection of
    // examples. A new blocking code must arrive with BOTH halves of its promise: a
    // fixture in the emission suite proving it fires, and at least one here proving
    // where it does not. Half a promise is what produced TASK-33.
    expect(Object.keys(STAYS_SILENT).sort()).toEqual([...BLOCKING_CHECKS].sort());
  });

  it('has at least one fixture per member, with the corpus size pinned per code', () => {
    // Pinned, not merely non-empty. Fixtures are the only thing standing between this
    // suite and a comfortable green, and the cheapest way to make a failure disappear
    // is to delete the case that produced it. A count that changes has to be changed
    // here too, in the diff, where it is visible.
    expect(
      Object.fromEntries(
        Object.entries(STAYS_SILENT).map(([code, fixtures]) => [code, fixtures.length]),
      ),
    ).toEqual({
      YAMLSyntaxError: 72,
      LiquidHTMLSyntaxError: 10,
      MissingPartial: 2,
      UnknownFilter: 3,
      FilterArity: 4,
      JsonLiteralQuoteStyle: 3,
      GraphQLCheck: 2,
      GraphQLVariablesCheck: 1,
      InvalidHashAssignTarget: 4,
      MissingRenderPartialArguments: 1,
      MissingContentForLayout: 1,
    });
  });

  it('records the oracle behind every fixture, and which codes rest on which', () => {
    // An OBSERVATION, pinned so provenance cannot quietly weaken. `by-construction` is
    // the weakest claim available — it says only that the fixture's own project makes
    // it valid — so a code drifting toward it is a real loss of evidence, and this
    // fails when that happens rather than leaving it to a reader to notice.
    const oraclesByCode = Object.fromEntries(
      Object.entries(STAYS_SILENT).map(([code, fixtures]) => [
        code,
        [...new Set(fixtures.map((fixture) => fixture.oracle))].sort(),
      ]),
    );

    expect(oraclesByCode).toEqual({
      YAMLSyntaxError: ['dry-run'],
      LiquidHTMLSyntaxError: ['by-construction', 'generated-data'],
      MissingPartial: ['by-construction'],
      UnknownFilter: ['generated-data'],
      FilterArity: ['generated-data'],
      JsonLiteralQuoteStyle: ['dry-run'],
      GraphQLCheck: ['schema'],
      GraphQLVariablesCheck: ['by-construction'],
      InvalidHashAssignTarget: ['by-construction', 'runtime'],
      MissingRenderPartialArguments: ['by-construction'],
      MissingContentForLayout: ['by-construction'],
    });
  });

  for (const [code, fixtures] of Object.entries(STAYS_SILENT)) {
    it(`${code}: reports nothing, and blocks nothing, on valid input`, async () => {
      const observed = [];
      for (const fixture of fixtures) {
        observed.push(await observe(code, fixture));
      }

      // Whole-value across the entire corpus, so a failure names the shape and the
      // message it wrongly produced rather than just a count.
      expect(observed).toEqual(fixtures.map(silent));
    }, 120_000);
  }

  it('records which fixtures actually exercise tag adjacency', () => {
    // The same observation the emission suite pins, for the same reason: a fixture
    // rewritten into a single tag stops testing the axis, and stating today's answer
    // is the only way a change to that shows up.
    // Measured, not predicted: I expected `UnknownFilter` to carry the axis and it does
    // not. Its fixtures pair a `{% assign %}` with an `{{ output }}`, and the axis only
    // exists between two `{% %}` tags, which is the boundary the transformation varies
    // and the one the defect lived on.
    const withAxis = Object.entries(STAYS_SILENT)
      .filter(([, fixtures]) =>
        fixtures.some((fixture) => adjacencyVariants(fixture.content).length > 1),
      )
      .map(([code]) => code);

    expect(withAxis).toEqual(['LiquidHTMLSyntaxError', 'InvalidHashAssignTarget']);
  });

  for (const [code, fixtures] of Object.entries(STAYS_SILENT)) {
    const multiTag = fixtures.filter((fixture) => adjacencyVariants(fixture.content).length > 1);
    if (multiTag.length === 0) continue;

    it(`${code}: inter-tag whitespace does not break the silence`, async () => {
      const observed = [];
      const expected = [];
      for (const fixture of multiTag) {
        for (const content of adjacencyVariants(fixture.content)) {
          observed.push(await observe(code, { ...fixture, content }));
          expected.push(silent(fixture));
        }
      }

      expect(observed).toEqual(expected);
    }, 120_000);
  }

  it('still refuses YAML that genuinely does not parse, in every admitted location', async () => {
    // The one control kept here rather than left to the emission suite. Suppressing
    // `DUPLICATE_KEY` is an edit that could widen into hiding real parse failures, and
    // the whole YAML corpus above would pass just as happily if it had.
    const broken = 'name: car\nproperties: [unclosed\n';
    const locations = [
      SCHEMA,
      TRANSLATIONS,
      'app/transactable_types/t.yml',
      'app/user_profile_types/u.yml',
    ];

    const observed = [];
    for (const filePath of locations) {
      const result = await validate(filePath, broken);
      observed.push({
        filePath,
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    // Expectation built from the INPUT list, not from what was observed — otherwise a
    // run that produced fewer results than locations would pass.
    expect(observed).toEqual(
      locations.map((filePath) => ({ filePath, blocked: true, errors: ['YAMLSyntaxError'] })),
    );
  }, 120_000);

  it('reports a duplicate key as a non-blocking WARNING, not as silence and not as a block', async () => {
    // THE DISTINCTION THIS SUITE NOW HAS TO CARRY. The duplicate-key fixtures above
    // assert `fromCheck: []` for `YAMLSyntaxError` and `blocked: false` — both still
    // true, and neither says anything about whether some OTHER check speaks up. Once
    // `DuplicateYAMLKey` landed, "no diagnostic at all" and "no block" stopped being the
    // same claim, and only the second one is the promise this server makes.
    //
    // So the absence of a block is asserted together with the PRESENCE of the advisory.
    // Asserting only the silence would let the check be deleted without a failure;
    // asserting only the warning would let it drift onto the write gate.
    const observed = [];
    for (const [name, content] of [
      ['top level', 'name: car\nname: van\n'],
      ['nested', 'name: car\nproperties:\n  make: ford\n  make: audi\n'],
    ] as const) {
      const result = await validate(SCHEMA, content);
      observed.push({
        name,
        blocked: result.must_fix_before_write,
        errorChecks: [...new Set(result.errors.map((error) => error.check))],
        warningChecks: [...new Set(result.warnings.map((warning) => warning.check))],
      });
    }

    expect(observed).toEqual([
      { name: 'top level', blocked: false, errorChecks: [], warningChecks: ['DuplicateYAMLKey'] },
      { name: 'nested', blocked: false, errorChecks: [], warningChecks: ['DuplicateYAMLKey'] },
    ]);
  }, 120_000);
});
