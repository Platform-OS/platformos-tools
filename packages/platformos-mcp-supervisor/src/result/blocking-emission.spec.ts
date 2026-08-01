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
