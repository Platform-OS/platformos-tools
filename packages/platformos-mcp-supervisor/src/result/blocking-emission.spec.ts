import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SourceCodeType,
  isSupportedSourceFile,
  path as pathUtils,
  toSourceCode,
} from '@platformos/platformos-check-common';
import { AppCache } from '@platformos/platformos-check-node';

import { BLOCKING_CHECKS } from './blocking.js';
import type { ValidateCodeResult } from './types.js';
import type { SupervisorContext } from '../context.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import { runValidateCode } from '../transport/validate-code.js';

/**
 * Every member of `BLOCKING_CHECKS` must actually be able to block a write.
 *
 * WHY THIS FILE EXISTS, and what shipped without it. `BLOCKING_CHECKS` is the only
 * place this server makes an independent judgement, and every member is a promise
 * that something gets caught. Two green suites used to sit on either side of that
 * promise without either one testing it:
 *
 *   blocking.spec.ts   asserts `blocksWrite([{check: 'X'}])` is true. That is a Set
 *                      lookup. It passes whether or not the check exists.
 *   the check's spec   asserts the check reports, given a hand-built context. It
 *                      passes whether or not the supervisor ever routes a file to it.
 *
 * Nothing observed "the check is registered, enabled, defended in a comment, and
 * emits nothing." An external evaluation found exactly that, and the shape of the
 * failure is why it went unnoticed for so long:
 *
 *   - SILENT. "This check is dead" and "this file is fine" are byte-identical on
 *     the wire: `status: ok`, `must_fix_before_write: false`.
 *   - FAILS OPEN. An unrecognised code is deliberately non-blocking (see
 *     `blocksWrite`), so every failure of this kind resolves to a FALSE APPROVAL.
 *     It cannot fail safe.
 *   - SELF-CONCEALING. The 12-line comment in `blocking.ts` argues the check
 *     belongs, so a reader checking their work finds confirmation.
 *   - IT LOOKS LIKE A FIX. The check's known false block disappeared at the same
 *     time, and nobody investigates a false block going away.
 *
 * SO: real buffers, the real pipeline, one fixture per member, and the table is
 * checked against the set — a member without a fixture fails, rather than being
 * quietly uncovered.
 *
 * WHY THE WHOLE PIPELINE and not `check()` or `runBatchLint`. Emission is only half
 * the promise; the other half is that the supervisor ROUTES a file to the check at
 * all. Those fail independently — `ValidJSON` and `JSONSyntaxError` emit perfectly
 * well under `check()` and are unreachable here, which is why they are no longer in
 * the set — so a test one layer down would have reported them green and left the
 * hole open.
 *
 * WHY THE DEFAULT CONFIG. No `.platformos-check.yml` is written, so these run under
 * the config a real project gets. "Enabled in the shipped default" is part of what
 * is being promised; `extends: platformos-check:nothing` plus an explicit enable
 * would assert around it.
 */

/** A project on disk, plus the buffer under edit, that must produce one code. */
interface EmissionFixture {
  /** Files written to the temp project before the call. */
  project?: Record<string, string>;
  filePath: string;
  content: string;
  /**
   * Every distinct check in `errors[]`, sorted. Usually just the code under test;
   * where a second check fires on the same construct that is stated, not filtered
   * out, so a fixture growing an unexpected finding fails here.
   */
  errors: string[];
}

const PAGE = 'app/views/pages/index.liquid';

/**
 * Fixtures are MINIMAL on purpose: the smallest buffer that produces the code, so a
 * failure points at the check rather than at whichever of six constructs broke.
 *
 * Positions and message text are NOT asserted. They belong to check-common and are
 * pinned by its own specs; duplicating them here would couple this file to wording
 * it does not own, and break it for edits that change nothing about the promise.
 */
const EMITS: Record<string, EmissionFixture> = {
  LiquidHTMLSyntaxError: {
    filePath: PAGE,
    content: '{% if true %}\n',
    errors: ['LiquidHTMLSyntaxError'],
  },

  MissingPartial: {
    filePath: PAGE,
    content: "{% render 'no_such_partial' %}\n",
    errors: ['MissingPartial'],
  },

  UnknownFilter: {
    filePath: PAGE,
    content: "{{ 'a' | no_such_filter_xyz }}\n",
    errors: ['UnknownFilter'],
  },

  FilterArity: {
    // `upcase` takes the piped input and nothing else; three positional arguments
    // is `Liquid::ArgumentError` at runtime.
    filePath: PAGE,
    content: "{{ 'a' | upcase: 1, 2, 3 }}\n",
    errors: ['FilterArity'],
  },

  JsonLiteralQuoteStyle: {
    // Single-quoted key in an assign JSON literal. `{{ o }}` only keeps the buffer
    // free of an unrelated `UnusedAssign` warning.
    filePath: PAGE,
    content: "{% assign o = {'k': 1} %}{{ o }}\n",
    errors: ['JsonLiteralQuoteStyle'],
  },

  InvalidHashAssignTarget: {
    // The two tags are separated. Detection depends on the target's inferred type
    // being in scope at the `hash_assign`, which is check-common's business and is
    // pinned by that check's own spec; what this fixture proves is that a reported
    // offense reaches the gate and blocks.
    filePath: PAGE,
    content: "{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}\n",
    errors: ['InvalidHashAssignTarget'],
  },

  MissingContentForLayout: {
    filePath: 'app/views/layouts/application.liquid',
    content: '<html><body></body></html>\n',
    errors: ['MissingContentForLayout'],
  },

  MissingRenderPartialArguments: {
    // `PartialCallArguments` fires on the same call site and is deliberately NOT
    // blocking; `blocking.ts` relies on exactly this pairing to argue that the
    // blocking half of that check is independently covered. Stated so the pairing
    // is observed rather than assumed.
    project: {
      'app/views/partials/card.liquid':
        '{% doc %}\n  @param title {string} Title\n{% enddoc %}\n{{ title }}\n',
    },
    filePath: PAGE,
    content: "{% render 'card' %}\n",
    errors: ['MissingRenderPartialArguments', 'PartialCallArguments'],
  },

  YAMLSyntaxError: {
    // A model schema whose second property sits one column left of the sequence
    // item above it. `--dry-run` rejects this and fails the whole changeset; before
    // the check existed the supervisor returned `ok` with nothing in `errors[]`.
    filePath: 'app/schema/car.yml',
    content: 'name: car\nproperties:\n - name: make\n   type: string\n  year: 1\n',
    errors: ['YAMLSyntaxError'],
  },

  GraphQLCheck: {
    filePath: 'app/graphql/broken.graphql',
    content: 'query { no_such_root_field { id } }\n',
    errors: ['GraphQLCheck'],
  },

  GraphQLVariablesCheck: {
    // Passes a variable the operation does not declare, and omits the one it
    // requires — both are the same code.
    project: {
      'app/graphql/get_thing.graphql': 'query get_thing($id: ID!) { records { results { id } } }\n',
    },
    filePath: PAGE,
    content: "{% graphql g = 'get_thing', wrong_var: 1 %}\n",
    errors: ['GraphQLVariablesCheck'],
  },
};

/**
 * Codes REMOVED from `BLOCKING_CHECKS` because nothing this server accepts can
 * produce them, with the buffers that prove it.
 *
 * `ValidJSON` and `JSONSyntaxError` both declare `type: SourceCodeType.JSON`, and
 * check-common runs a check only against files of its own type. No buffer this
 * server accepts is ever parsed as JSON — `isSupportedSourceFile` admits `.liquid`,
 * `.graphql` and `.yml`/`.yaml` and nothing else, and those three parse as
 * `LiquidHtml`, `GraphQL` and `YAML`. A `.json` buffer is declined
 * `unsupported_type` before any check runs, so both entries were promising coverage
 * the input filter forecloses.
 *
 * KEPT AS A STANDING PROOF rather than deleted with the entries, for two reasons.
 * They read as obviously belonging — "the file does not parse" is the strongest
 * membership argument in `blocking.ts`, and it was TRUE of the checks and irrelevant
 * to this server — so the removal will look like an oversight to the next reader.
 * And if `.json` ever becomes a supported type, the exhaustiveness guard will demand
 * fixtures for both the moment they are re-added; these assertions are what will
 * fail first, saying exactly what changed and why they were out.
 */
interface UnreachableProof {
  filePath: string;
  /** Content that WOULD produce the code, if the file were ever checked. */
  content: string;
}

const NEVER_REACHES_THE_GATE: Record<string, UnreachableProof> = {
  ValidJSON: { filePath: 'app/config.json', content: 'not a json value at all\n' },
  JSONSyntaxError: { filePath: 'app/views/pages/data.json', content: '{ "a": ,\n' },
};

/**
 * Whitespace between two Liquid tags, varied — the axis a fixture cannot exercise by
 * being minimal.
 *
 * WHY THIS EXISTS. Asserting that ONE buffer emits cannot detect a check that is
 * blind to a DIFFERENT buffer for the same defect. `InvalidHashAssignTarget` was
 * exactly that: it tracked a variable's type over a range starting at the defining
 * tag's end offset and excluded a lookup at precisely that offset, so it went silent
 * when the two tags abutted and fired with one space between them. The fixture here
 * used the separated form, so this suite was green while a member of
 * `BLOCKING_CHECKS` had a hole. Separation between tags is formatting; it must never
 * change a verdict.
 *
 * WHY THE TRANSFORMATION IS THE FIXTURE'S OWN TEXT rather than an injected probe.
 * Prefixing or appending a benign `{% assign %}` in both spacings was measured
 * across all ten members and changed NOTHING anywhere — including for the one check
 * that has the defect, because the probe's adjacency is not the pair the check
 * reasons about. It would have produced twenty extra lint calls and zero signal. The
 * axis only exists between tags the check actually relates to each other, which
 * means it exists only where a fixture already contains two of them.
 *
 * That makes the axis THIN by measurement, not by neglect: fixtures above are
 * deliberately minimal, and most are a single construct with no inter-tag boundary
 * to vary. Which members genuinely carry the axis is pinned below rather than left
 * implicit, so a fixture that quietly loses it is a visible change.
 */
const TAGS_APART = /%\}\s+\{%/g;
const TAGS_TOGETHER = /%\}\{%/g;

/** The distinct spellings of `content` that differ only in inter-tag whitespace. */
function adjacencyVariants(content: string): string[] {
  return [
    ...new Set([
      content,
      content.replace(TAGS_APART, '%}{%'),
      content.replace(TAGS_TOGETHER, '%}\n{%'),
    ]),
  ];
}

describe('Integration: every blocking check can actually block', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-emission-'));
    // A `.git` directory is how the project root is recognized.
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
    // Real adapters: this is the same call path the MCP handler takes.
    return (await runValidateCode(ctx, { file_path: filePath, content })) as ValidateCodeResult;
  };

  it('has a fixture for every member of BLOCKING_CHECKS, and none for a non-member', () => {
    // The exhaustiveness guard, and the reason this file is more than a collection
    // of examples. Adding a member without evidence that it fires fails HERE, at the
    // moment the promise is made, rather than in production where a check that emits
    // nothing is indistinguishable from a clean file.
    //
    // Every member must appear in EMITS. There is no second list to fall back into:
    // a code that cannot be demonstrated blocking does not belong in the set, which
    // is exactly the conclusion the two below were removed on.
    expect(Object.keys(EMITS).sort()).toEqual([...BLOCKING_CHECKS].sort());
  });

  it('does not gate on the two removed codes, however the buffer is spelled', () => {
    // Guards the removal itself. Re-adding either without also making `.json`
    // reachable puts back a member that cannot ever fire, and the guard above would
    // then demand a fixture that provably cannot be written.
    expect(Object.keys(NEVER_REACHES_THE_GATE).map((code) => BLOCKING_CHECKS.has(code))).toEqual([
      false,
      false,
    ]);
  });

  for (const [code, fixture] of Object.entries(EMITS)) {
    it(`emits ${code} from a real buffer, and it blocks the write`, async () => {
      write(fixture.project);

      const result = await validate(fixture.filePath, fixture.content);

      expect({
        blocked: result.must_fix_before_write,
        status: result.status,
        errors: [...new Set(result.errors.map((error) => error.check))].sort(),
      }).toEqual({
        blocked: true,
        status: 'error',
        errors: [...fixture.errors].sort(),
      });
    });
  }

  it('records which fixtures actually exercise tag adjacency', () => {
    // Not an exemption list — an OBSERVATION, pinned so it cannot drift silently.
    // A fixture rewritten into a single tag stops testing the axis, and the only way
    // to notice is to state today's answer and let a change fail. Equally, adding a
    // multi-tag fixture shows up here as new coverage rather than passing unremarked.
    const withAxis = Object.entries(EMITS)
      .filter(([, fixture]) => adjacencyVariants(fixture.content).length > 1)
      .map(([code]) => code);

    expect(withAxis).toEqual(['InvalidHashAssignTarget']);
  });

  for (const [code, fixture] of Object.entries(EMITS)) {
    it(`${code}: inter-tag whitespace does not change the verdict`, async () => {
      write(fixture.project);
      const variants = adjacencyVariants(fixture.content);

      const verdicts = [];
      for (const content of variants) {
        const result = await validate(fixture.filePath, content);
        verdicts.push({
          blocked: result.must_fix_before_write,
          errors: [...new Set(result.errors.map((error) => error.check))].sort(),
        });
      }

      // Stated as AGREEMENT: every spelling must produce the SAME verdict, and the
      // expectation is written once. A member is never given a second hand-written
      // answer to satisfy, so a check that behaves differently across shapes fails
      // here instead of being encoded as though it were intended.
      const agreed = { blocked: true, errors: [...fixture.errors].sort() };
      expect(verdicts).toEqual(variants.map(() => agreed));
    });
  }

  for (const [code, proof] of Object.entries(NEVER_REACHES_THE_GATE)) {
    it(`cannot reach ${code}: the only files that produce it are never checked`, async () => {
      const result = await validate(proof.filePath, proof.content);

      expect({
        status: result.status,
        reason: result.not_applicable_reason,
        blocked: result.must_fix_before_write,
        errors: result.errors,
      }).toEqual({
        status: 'not_applicable',
        reason: 'unsupported_type',
        blocked: false,
        errors: [],
      });
    });
  }

  /**
   * The server instructions name filters-in-conditions as a blocking construct and
   * filters-in-tag-operands as explicitly NOT reported. Both halves are pinned HERE,
   * through the real pipeline, because prose cannot fail.
   *
   * The pairing is the point. A gate wide enough to block every `|` in a tag would
   * satisfy the first table on its own, and a grammar wide enough to accept every `|`
   * would satisfy the second on its own. Only running both catches a fix that traded
   * one direction for the other — which is exactly what the naive fix here does.
   *
   * Both tables were settled against `pos-cli deploy --dry-run`, each construct
   * deployed with the filter and again without it. The refusals are converter
   * REJECTIONS, which fail the whole changeset rather than one file.
   */
  const FILTER_REFUSED_BY_THE_CONVERTER = [
    "{% if 'a' | upcase == 'A' %}y{% endif %}\n",
    "{% unless 'a' | upcase == 'A' %}y{% endunless %}\n",
    "{% if false %}n{% elsif 'a' | upcase == 'A' %}y{% endif %}\n",
    "{% for i in 'a,b' | split: ',' %}{{ i }}{% endfor %}\n",
  ];

  const FILTER_ACCEPTED_BY_THE_CONVERTER = [
    "{% cache 'k' | append: '1' %}x{% endcache %}\n",
    "{% log 'msg' | upcase %}\n",
    "{% yield 'slot' | upcase %}\n",
    "{% redirect_to '/p' | append: '/x' %}\n",
    "{% case 'a' | upcase %}{% when 'A' %}y{% endcase %}\n",
    "{% cycle 'a' | upcase, 'b' %}\n",
  ];

  it('blocks a filter inside a condition, exactly as the instructions claim', async () => {
    const verdicts = [];
    for (const content of FILTER_REFUSED_BY_THE_CONVERTER) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    // WHAT THIS DOES AND DOES NOT PROVE, measured by sabotage rather than assumed.
    // The block here is OVER-DETERMINED: deleting `checkFilterInCondition` leaves it
    // green (a truthiness heuristic fires instead, with a worse message), and widening
    // the grammar to accept these leaves it green too (stage 2 then throws on a shape
    // its mapping does not model). So this pins the CLAIM the instructions make — these
    // constructs block — and not which rule produces it. The rule's own identity and
    // wording are pinned in check-common's `InvalidConditionalNode.spec.ts`.
    expect(verdicts).toEqual(
      FILTER_REFUSED_BY_THE_CONVERTER.map(() => ({
        blocked: true,
        errors: ['LiquidHTMLSyntaxError'],
      })),
    );
  });

  it('says NOTHING about a filter in a tag operand, exactly as the instructions claim', async () => {
    // The control for the test above, and a false block if it ever fails: the
    // converter accepts every one of these, and a write gate the agent cannot
    // override is the most expensive thing this server can get wrong.
    const verdicts = [];
    for (const content of FILTER_ACCEPTED_BY_THE_CONVERTER) {
      const result = await validate(PAGE, content);
      verdicts.push({ blocked: result.must_fix_before_write, errors: result.errors });
    }

    expect(verdicts).toEqual(
      FILTER_ACCEPTED_BY_THE_CONVERTER.map(() => ({ blocked: false, errors: [] })),
    );
  });

  it('routes no supported file type to the JSON checks, which is WHY those two were removed', () => {
    // The cause behind the two results above, asserted structurally so it does not
    // rest on two hand-picked paths. Every extension `isSupportedSourceFile` admits,
    // paired with the type check-common parses it as — JSON appears nowhere.
    const samples = [
      'file:///p/app/views/pages/index.liquid',
      'file:///p/app/graphql/get_thing.graphql',
      'file:///p/app/translations/en.yml',
      'file:///p/app/model_schemas/thing.yaml',
    ];

    expect(samples.map((uri) => [isSupportedSourceFile(uri), toSourceCode(uri, '').type])).toEqual([
      [true, SourceCodeType.LiquidHtml],
      [true, SourceCodeType.GraphQL],
      [true, SourceCodeType.YAML],
      [true, SourceCodeType.YAML],
    ]);
  });
});
