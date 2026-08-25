import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystem, path as pathUtils } from '@platformos/platformos-check-node';

import { runImpact, type ImpactInput } from './impact.js';
import { createProjectScan } from './project-scan.js';
import { runBatchLint, type BatchBuffer } from '../lint/lint-batch.js';
import { MAX_CANDIDATE_BYTES, MAX_DEPENDANTS_LINTED } from '../cost-model.js';
import type { ValidateCodeImpact } from '../result/types.js';

/**
 * Impact runs the REAL check engine against a REAL project on disk, because that is the
 * whole design: the findings it reports are the engine's, not a second opinion computed
 * here. Stubbing the lint would test the plumbing and prove nothing about the answer.
 */
describe('runImpact', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pos-impact-'));
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const write = (files: Record<string, string>) => {
    for (const [relativePath, source] of Object.entries(files)) {
      const absolute = join(projectDir, relativePath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, source, 'utf8');
    }
  };

  /** No vocabulary: `see_also` comes from the check registry, so enrichment still works. */
  const docset = async () => ({ filters: [], tags: [], objects: [] });

  const run = (
    buffers: BatchBuffer[],
    overrides: Partial<ImpactInput> = {},
  ): Promise<Map<string, ValidateCodeImpact>> => {
    const scan = createProjectScan(
      pathUtils.normalize(pathUtils.toUri(projectDir)),
      NodeFileSystem,
      new Map(
        buffers.map((buffer) => [
          pathUtils.normalize(pathUtils.toUri(join(projectDir, buffer.filePath))),
          buffer.content,
        ]),
      ),
    );
    return runImpact({
      projectDir,
      buffers,
      scan,
      lint: runBatchLint,
      docset,
      log: () => {},
      ...overrides,
    });
  };

  const buffer = (filePath: string, content: string): BatchBuffer => ({ filePath, content });

  /** Just the shape the assertions care about: which file broke, and with which checks. */
  const brokenBy = (impact: ValidateCodeImpact | undefined) =>
    (impact?.breaks ?? []).map((broken) => ({
      file: broken.file,
      checks: broken.diagnostics.map((diagnostic) => diagnostic.check),
    }));

  const CARD = 'app/views/partials/card.liquid';
  /**
   * LOWERCASE `{string}` deliberately. platformOS publishes its own `param_types` — array,
   * boolean, date, number, object, string, time — and `{String}` is not among them, so the
   * capitalised spelling makes every fixture below carry an unrelated `ValidDocParamTypes`
   * error on the buffer under test.
   */
  const DOC_CARD = `{% doc %}
  @param {string} title - required title
{% enddoc %}
<div>{{ title }}</div>`;

  describe('what the change broke elsewhere', () => {
    it('reports a page broken by a partial that gained a required @param', async () => {
      write({ [CARD]: '<div></div>', 'app/views/pages/home.liquid': "{% render 'card' %}" });

      const impacts = await run([buffer(CARD, DOC_CARD)]);

      expect(brokenBy(impacts.get(CARD))).toEqual([
        { file: 'app/views/pages/home.liquid', checks: ['MissingRenderPartialArguments'] },
      ]);
    });

    /**
     * A GraphQL edit, which the previous `{% doc %}`-gated design could not report at all —
     * a `.graphql` file can carry no doc block, so impact was structurally silent on it.
     */
    it('reports a caller broken by a renamed GraphQL variable', async () => {
      write({
        'app/graphql/get_user.graphql': 'query get_user($id: ID!) { records { results { id } } }',
        'app/views/pages/user.liquid': "{% graphql g = 'get_user', id: '1' %}",
      });

      const impacts = await run([
        buffer(
          'app/graphql/get_user.graphql',
          'query get_user($user_id: ID!) { records { results { id } } }',
        ),
      ]);

      // Twice: the check reports the declared variable and the passed one separately.
      expect(brokenBy(impacts.get('app/graphql/get_user.graphql'))).toEqual([
        {
          file: 'app/views/pages/user.liquid',
          checks: ['GraphQLVariablesCheck', 'GraphQLVariablesCheck'],
        },
      ]);
    });

    /**
     * The findings are the ENGINE'S, which is the point of the diff — so they arrive
     * enriched exactly like any other diagnostic rather than as a locally invented shape.
     */
    it("carries the check's own message, severity and documentation link", async () => {
      write({ [CARD]: '<div></div>', 'app/views/pages/home.liquid': "{% render 'card' %}" });

      const found = (await run([buffer(CARD, DOC_CARD)])).get(CARD)?.breaks?.[0].diagnostics[0];

      expect({
        check: found?.check,
        severity: found?.severity,
        hasMessage: (found?.message.length ?? 0) > 0,
        see_also: found?.see_also,
      }).toEqual({
        check: 'MissingRenderPartialArguments',
        severity: 'error',
        hasMessage: true,
        see_also:
          'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-render-partial-arguments',
      });
    });
  });

  describe('what was already broken is not this change’s doing', () => {
    /**
     * The whole reason for a baseline pass. `home` renders a partial that does not exist,
     * which is a blocking error — and it was one before this edit too, so reporting it here
     * would blame the edit for someone else's bug and bury the finding that IS its fault.
     */
    it('excludes a pre-existing finding while still reporting the caused one', async () => {
      write({
        [CARD]: '<div></div>',
        'app/views/pages/home.liquid': "{% render 'ghost' %}{% render 'card' %}",
      });

      expect(brokenBy((await run([buffer(CARD, DOC_CARD)])).get(CARD))).toEqual([
        { file: 'app/views/pages/home.liquid', checks: ['MissingRenderPartialArguments'] },
      ]);
    });

    it('reports nothing at all when the change breaks nobody', async () => {
      write({
        [CARD]: '<div></div>',
        'app/views/pages/home.liquid': "{% render 'card', title: 'set' %}",
      });

      expect((await run([buffer(CARD, DOC_CARD)])).get(CARD)).toEqual({ status: 'computed' });
    });

    /**
     * CONTROL for the test above: the same project, the same dependant, and the only
     * difference is whether the caller satisfies the new contract. Without this, "reports
     * nothing" would pass just as well with the whole stage deleted.
     */
    it('CONTROL: the same fixture with an unsatisfied contract DOES report', async () => {
      write({ [CARD]: '<div></div>', 'app/views/pages/home.liquid': "{% render 'card' %}" });

      expect((await run([buffer(CARD, DOC_CARD)])).get(CARD)?.breaks).toHaveLength(1);
    });
  });

  describe('the changeset is one change, and the baseline is none of it', () => {
    /**
     * The baseline pass must overlay NOTHING. If it overlaid the changeset, a dependant
     * broken by two buffers at once would show the same findings in both passes and the diff
     * would report neither — each buffer's damage hiding the other's.
     */
    it('reports both breaks when one page is broken by two buffers at once', async () => {
      write({
        [CARD]: '<div></div>',
        'app/views/partials/badge.liquid': '<span></span>',
        'app/views/pages/home.liquid': "{% render 'card' %}{% render 'badge' %}",
      });

      const impacts = await run([
        buffer(CARD, DOC_CARD),
        buffer(
          'app/views/partials/badge.liquid',
          `{% doc %}\n  @param {string} label - required label\n{% enddoc %}\n<span>{{ label }}</span>`,
        ),
      ]);

      // BOTH findings appear under BOTH buffers, and that is the intended contract: a
      // request is ONE change, and impact does not guess which buffer of it caused what.
      // What matters is that neither break is LOST, which is what a changeset-overlaid
      // baseline would have done to both of them.
      const both = [
        {
          file: 'app/views/pages/home.liquid',
          checks: ['MissingRenderPartialArguments', 'MissingRenderPartialArguments'],
        },
      ];
      expect([
        brokenBy(impacts.get(CARD)),
        brokenBy(impacts.get('app/views/partials/badge.liquid')),
      ]).toEqual([both, both]);
    });

    it('never reports a file that is itself in the changeset — its own result covers it', async () => {
      write({
        [CARD]: '<div></div>',
        'app/views/pages/home.liquid': "{% render 'card' %}",
      });

      // `home` is being edited too, so its breakage is its own diagnostics, not impact's.
      const impacts = await run([
        buffer(CARD, DOC_CARD),
        buffer('app/views/pages/home.liquid', "{% render 'card' %}"),
      ]);

      expect(impacts.get(CARD)).toEqual({ status: 'computed' });
    });
  });

  /**
   * "Too much candidate text to examine" must never come out as "nothing depends on this".
   * They are opposite claims and the difference is invisible in the payload — an empty
   * `breaks` under `computed` reads as a clean bill of health, so the STATUS has to carry it.
   */
  describe('when discovery refuses the work', () => {
    it('reports unavailable, never a clean computed answer', async () => {
      const files: Record<string, string> = {
        [CARD]: '<div></div>',
        'app/views/pages/home.liquid': "{% render 'card' %}",
      };
      // Candidates by mention only; their SIZE is what trips the bound.
      for (let i = 0; i < 8; i += 1) {
        files[`app/views/pages/bulk${i}.liquid`] =
          `<!-- card -->${'x'.repeat(Math.ceil(MAX_CANDIDATE_BYTES / 4))}`;
      }
      write(files);

      expect((await run([buffer(CARD, DOC_CARD)])).get(CARD)).toEqual({ status: 'unavailable' });
    });

    /**
     * CONTROL: the same fixture and the same candidate COUNT, small enough to examine.
     * Without it, the test above would pass with impact deleted outright.
     */
    it('CONTROL: the same shape under the bound reports the break normally', async () => {
      const files: Record<string, string> = {
        [CARD]: '<div></div>',
        'app/views/pages/home.liquid': "{% render 'card' %}",
      };
      for (let i = 0; i < 8; i += 1) files[`app/views/pages/bulk${i}.liquid`] = '<!-- card -->';
      write(files);

      expect(brokenBy((await run([buffer(CARD, DOC_CARD)])).get(CARD))).toEqual([
        { file: 'app/views/pages/home.liquid', checks: ['MissingRenderPartialArguments'] },
      ]);
    });
  });

  describe('files with no dependants to find', () => {
    it('reports not_applicable for a YAML file, which the graph holds no edges to', async () => {
      write({ 'app/custom_model_types/blog_post.yml': 'name: blog_post\n' });

      expect(
        (await run([buffer('app/custom_model_types/blog_post.yml', 'name: blog_post\n')])).get(
          'app/custom_model_types/blog_post.yml',
        ),
      ).toEqual({ status: 'not_applicable' });
    });

    it('reports not_applicable for a Liquid file in no platformOS directory', async () => {
      expect(
        (await run([buffer('scripts/generate.liquid', '<div></div>')])).get(
          'scripts/generate.liquid',
        ),
      ).toEqual({ status: 'not_applicable' });
    });
  });

  /**
   * The bound is the REAL limit on impact, because `IMPACT_DEADLINE_MS` cannot be: a lint is
   * synchronous CPU work and no timer preempts it (`deadline.ts`). Hitting it shortens the
   * ANALYSIS rather than the output, so it has to be reported — a clean answer that quietly
   * skipped 200 dependants is the exact defect this whole line of work exists to remove.
   */
  it('bounds how many dependants it lints, and says so when it does', async () => {
    const OVER = MAX_DEPENDANTS_LINTED + 5;
    const files: Record<string, string> = { [CARD]: '<div></div>' };
    for (let i = 0; i < OVER; i += 1) {
      files[`app/views/partials/w${String(i).padStart(3, '0')}.liquid`] = "{% render 'card' %}";
    }
    write(files);

    const impact = (await run([buffer(CARD, DOC_CARD)])).get(CARD);

    expect({
      breaks: impact?.breaks?.length,
      unchecked: impact?.unchecked_dependants,
    }).toEqual({
      breaks: MAX_DEPENDANTS_LINTED,
      unchecked: { returned: MAX_DEPENDANTS_LINTED, total: OVER },
    });
  }, 120_000);

  it('says nothing about a bound it did not hit', async () => {
    write({
      [CARD]: '<div></div>',
      'app/views/partials/wrapper.liquid': "{% render 'card' %}",
    });

    expect((await run([buffer(CARD, DOC_CARD)])).get(CARD)?.unchecked_dependants).toBeUndefined();
  });

  /**
   * `lintBuffers` overlays buffers into check-node's process-shared `App` and reverts them on
   * the way out, with no lock. Two passes in flight at once interleave one's overlay with the
   * other's rollback, and the corruption is silent — a dependant linted against a
   * half-reverted project. Asserted here rather than trusted, because the failure it prevents
   * would never look like a failure.
   */
  it('never has two lint passes in flight at once', async () => {
    write({ [CARD]: '<div></div>', 'app/views/pages/home.liquid': "{% render 'card' %}" });

    let inFlight = 0;
    let overlapped = false;

    await run([buffer(CARD, DOC_CARD)], {
      lint: async (input) => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        try {
          return await runBatchLint(input);
        } finally {
          inFlight -= 1;
        }
      },
    });

    expect(overlapped).toBe(false);
  });

  /**
   * The baseline pass exists only to subtract; a dependant that found nothing in the first
   * pass has nothing to subtract from. Skipping it is what keeps a clean project — the
   * common case — down to a single extra pass.
   */
  it('does not run a baseline pass when no dependant found anything', async () => {
    // A PARTIAL dependant, deliberately: a page reports `DeprecatedFrontmatterField`
    // whatever it contains, so a page could never demonstrate the skip. Measured, not
    // assumed — the first version of this test used a page and never skipped.
    write({
      [CARD]: '<div></div>',
      'app/views/partials/wrapper.liquid': "{% render 'card', title: 'set' %}",
    });

    let passes = 0;
    await run([buffer(CARD, DOC_CARD)], {
      lint: async (input) => {
        passes += 1;
        return runBatchLint(input);
      },
    });

    expect(passes).toEqual(1);
  });
});
