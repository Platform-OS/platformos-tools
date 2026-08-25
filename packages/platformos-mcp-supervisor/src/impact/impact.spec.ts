import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystem, path as pathUtils } from '@platformos/platformos-check-node';
import { toSourceCode } from '@platformos/platformos-graph';

import { runImpact } from './impact.js';
import { createProjectScan, type ProjectScan } from './project-scan.js';

/**
 * Signature impact is an I/O adapter over the project's own text, so these run against a
 * REAL project on disk rather than a stubbed graph.
 */
describe('runImpact', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pos-impact-'));
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

  const scanOf = (buffers: Record<string, string> = {}): ProjectScan =>
    createProjectScan(
      pathUtils.normalize(pathUtils.toUri(projectDir)),
      NodeFileSystem,
      new Map(
        Object.entries(buffers).map(([relativePath, content]) => [
          pathUtils.normalize(pathUtils.toUri(join(projectDir, relativePath))),
          content,
        ]),
      ),
    );

  /**
   * A scan that throws the moment it is consulted, so "the project was not read" is an
   * assertion rather than a claim. Used both ways below: to prove a cheap answer costs
   * nothing, and — as the control — to prove the expensive path really does read.
   */
  const throwingScan = (): ProjectScan => ({
    rootUri: pathUtils.normalize(pathUtils.toUri(projectDir)),
    fs: NodeFileSystem,
    sources: () => {
      throw new Error('the project must not be scanned');
    },
  });

  const run = (filePath: string, content = '', scan: ProjectScan = scanOf()) =>
    runImpact({ projectDir, filePath, content }, scan);

  const card = 'app/views/partials/card.liquid';

  /** A buffer declaring `title` (required) and `count` (optional). */
  const docBuffer = `{% doc %}
  @param {String} title - required title
  @param {Number} [count] - optional count
{% enddoc %}
<div>{{ title }}</div>`;

  const NOT_APPLICABLE = { scope: 'direct', status: 'not_applicable' };

  describe('the callers a {% doc %} contract breaks', () => {
    it('names each caller that omits a required @param or passes an undeclared one', async () => {
      write({
        [card]: '<div></div>',
        // ok: passes the required title, and nothing undeclared
        'app/views/pages/ok.liquid': "{% render 'card', title: 'a', count: 1 %}",
        'app/views/pages/missing.liquid': "{% render 'card', count: 1 %}",
        'app/views/pages/extra.liquid': "{% render 'card', title: 'a', colour: 'red' %}",
        'app/views/pages/bare.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/bare.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
          {
            caller: 'app/views/pages/extra.liquid',
            missing_required: [],
            unexpected_args: ['colour'],
          },
          {
            caller: 'app/views/pages/missing.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    /**
     * The field is a FINDING, never a clearance: an empty array would read as "checked,
     * every caller matches", which a scan of the callers that happen to be visible cannot
     * earn. The control below fires on the same fixture, so the silence is the code's
     * doing rather than a fixture with nothing in it.
     */
    it('omits signature_risk ENTIRELY when no visible caller mismatches', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/a.liquid': "{% render 'card', title: 'a' %}",
        'app/views/pages/b.liquid': "{% render 'card', title: 'b', count: 2 %}",
      });

      expect(await run(card, docBuffer)).toEqual({ scope: 'direct', status: 'computed' });
    });

    it('CONTROL: the same fixture with one bad call does report it', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/a.liquid': "{% render 'card', title: 'a' %}",
        'app/views/pages/b.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          { caller: 'app/views/pages/b.liquid', missing_required: ['title'], unexpected_args: [] },
        ],
      });
    });

    it('merges every bad call from one caller into a single entry, whatever the kind', async () => {
      write({
        [card]: '<div></div>',
        'app/views/partials/dual.liquid':
          "{% render 'card', colour: 'red' %}{% include 'card', size: 'big' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/partials/dual.liquid',
            missing_required: ['title'],
            unexpected_args: ['colour', 'size'],
          },
        ],
      });
    });

    it('caps the list at 10 callers, keeping the first in sorted order', async () => {
      write({
        [card]: '<div></div>',
        ...Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [
            `app/views/pages/p${String(i).padStart(2, '0')}.liquid`,
            "{% render 'card' %}",
          ]),
        ),
      });

      const result = await run(card, docBuffer);

      expect(result.signature_risk?.map((risk) => risk.caller)).toEqual([
        'app/views/pages/p00.liquid',
        'app/views/pages/p01.liquid',
        'app/views/pages/p02.liquid',
        'app/views/pages/p03.liquid',
        'app/views/pages/p04.liquid',
        'app/views/pages/p05.liquid',
        'app/views/pages/p06.liquid',
        'app/views/pages/p07.liquid',
        'app/views/pages/p08.liquid',
        'app/views/pages/p09.liquid',
      ]);
    });
  });

  /**
   * The cheap question is asked FIRST, and this is the whole cost argument: a project of
   * any size is read only when the buffer has a contract worth comparing against. On the
   * app this was measured on, no file declares `{% doc %}` — so the read never happens.
   */
  describe('nothing to compare against costs no project read', () => {
    it('reads no project text when the buffer declares no {% doc %} block', async () => {
      expect(await run(card, '<div>{{ title }}</div>', throwingScan())).toEqual(NOT_APPLICABLE);
    });

    it('reads no project text when the buffer does not parse', async () => {
      const broken = `{% doc %}
  @param {String} title - required title
{% enddoc %}
{% if x %}`;

      expect(await run(card, broken, throwingScan())).toEqual(NOT_APPLICABLE);
    });

    it('reads no project text for a YAML file, which cannot declare a contract', async () => {
      expect(await run('app/custom_model_types/blog_post.yml', '', throwingScan())).toEqual(
        NOT_APPLICABLE,
      );
    });

    it('reads no project text for a GraphQL file, which cannot declare a contract', async () => {
      expect(await run('app/graphql/get_posts.graphql', '', throwingScan())).toEqual(
        NOT_APPLICABLE,
      );
    });

    /**
     * The extension guard ahead of the parse saves WORK, not an answer — the two tests
     * above return `not_applicable` with it deleted, because the parse would only discover
     * the same thing more slowly. So the claim is a cost, and it is measured against the
     * parse it avoids as the control: without that control this passes on any machine fast
     * enough, and proves nothing about the guard. Measured, an 8 KB schema costs ~8.3 ms to
     * parse against ~0.05 ms for the guarded call — the 4x threshold is two orders of
     * magnitude of headroom, so it fails on the guard going missing rather than on load.
     */
    it('does not PARSE a non-Liquid buffer merely to discover it has no contract', async () => {
      const schema =
        'name: blog_post\nproperties:\n' +
        Array.from({ length: 200 }, (_, i) => `  - name: field_${i}\n    type: string\n`).join('');
      const filePath = 'app/custom_model_types/blog_post.yml';
      const uri = pathUtils.normalize(pathUtils.toUri(join(projectDir, filePath)));

      const elapsed = async (work: () => Promise<unknown>) => {
        for (let i = 0; i < 5; i++) await work(); // warm the parser and the JIT
        const started = performance.now();
        for (let i = 0; i < 20; i++) await work();
        return performance.now() - started;
      };

      const parsed = await elapsed(() => toSourceCode(uri, schema));
      const guarded = await elapsed(() => run(filePath, schema, throwingScan()));

      expect(guarded * 4 < parsed).toBe(true);
    });

    it('reads no project text for a Liquid file in no platformOS directory — nothing can name it', async () => {
      expect(await run('scripts/generate.liquid', docBuffer, throwingScan())).toEqual(
        NOT_APPLICABLE,
      );
    });

    /**
     * CONTROL for every case above. Without it each of them passes just as well with the
     * project read deleted outright, and the tests would be measuring nothing.
     */
    it('CONTROL: a buffer that DOES declare a contract reads the project', async () => {
      await expect(run(card, docBuffer, throwingScan())).rejects.toThrow(
        'the project must not be scanned',
      );
    });
  });

  describe('which callers are found', () => {
    /**
     * The name filter is an over-approximation, so everything past it must be EXACT. A file
     * that merely spells the name — in prose, or as the prefix of a different partial's
     * name — survives the filter and must contribute nothing, while the real caller in the
     * same fixture still reports.
     */
    it('ignores a file that only mentions the name without calling it', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/prose.liquid': '<p>the card component is documented elsewhere</p>',
        'app/views/pages/prefix.liquid': "{% render 'card_footer' %}",
        'app/views/partials/card_footer.liquid': '<footer></footer>',
        'app/views/pages/real.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/real.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    it('finds a caller in a module, whose reference spells the modules/<name>/ prefix', async () => {
      write({
        'modules/core/public/views/partials/badge.liquid': '<span></span>',
        'app/views/pages/index.liquid': "{% render 'modules/core/badge' %}",
      });

      expect(await run('modules/core/public/views/partials/badge.liquid', docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/index.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    it('includes function call sites — their args ARE @params, mirroring PartialCallArguments', async () => {
      write({
        [card]: '<div></div>',
        'app/lib/commands/run.liquid': "{% function r = 'card', count: 1 %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/lib/commands/run.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    /**
     * `background`/`graphql` args are scheduling and operation arguments, not `@param`s, so
     * flagging them would be a false positive the forward `PartialCallArguments` check never
     * makes. The render caller is the control: the fixture is not silent by accident.
     */
    it('ignores non-@param edges (background/graphql) while still reporting the render caller', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/render.liquid': "{% render 'card', title: 'a', colour: 'red' %}",
        'app/views/pages/bg.liquid': "{% background job = 'card', delay: 5 %}",
        'app/views/pages/gql.liquid': "{% graphql g = 'card', per_page: 10 %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/render.liquid',
            missing_required: [],
            unexpected_args: ['colour'],
          },
        ],
      });
    });
  });

  /**
   * WHY AN EMPTY ANSWER IS NOT A CLEARANCE, as a test rather than as prose. `{% render %}`
   * accepts a variable, and platformOS resolves it at runtime — measured: all four of
   * `{% render var %}`, `{% include var %}`, `{% function r = var %}` and an assigned
   * variable parse, and none yields an edge any static resolver can follow. So one variable
   * anywhere makes a file's caller set undecidable, which is exactly why impact publishes
   * findings only and never a count. The literal caller is the control: the fixture is not
   * silent by accident.
   */
  describe('the callers no static analysis can see', () => {
    /**
     * The other way a caller goes invisible, and the boundary that keeps it narrow: the
     * resolver needs an AST, so a caller that does not PARSE contributes nothing, while one
     * that parses and is merely BROKEN still does. The pair is what makes each half
     * meaningful — `broken` renders a partial that does not exist, which is a blocking lint
     * error, and it is still reported here.
     */
    it('cannot see an unparseable caller, while a caller that merely fails lint still reports', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/unparseable.liquid': "{% render 'card' %}{% if x %}",
        'app/views/pages/broken.liquid': "{% render 'nonexistent' %}{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/broken.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    it('cannot see a caller that names the partial by variable, and says nothing instead', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/dynamic.liquid': "{% assign chosen = 'card' %}{% render chosen %}",
        'app/views/pages/literal.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/literal.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });
  });

  describe('the changeset is what counts, not just disk', () => {
    it('reports a caller the buffer has just added', async () => {
      write({ [card]: '<div></div>', 'app/views/pages/index.liquid': '<p>nothing yet</p>' });

      const scan = scanOf({ 'app/views/pages/index.liquid': "{% render 'card' %}" });

      expect(await run(card, docBuffer, scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/index.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    it('stops reporting a caller whose bad call the buffer has just fixed', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/index.liquid': "{% render 'card' %}",
        'app/views/pages/other.liquid': "{% render 'card' %}",
      });

      const scan = scanOf({ 'app/views/pages/index.liquid': "{% render 'card', title: 'a' %}" });

      // `other` is the control: the fixed caller drops out, the untouched one stays.
      expect(await run(card, docBuffer, scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/other.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });

    /**
     * The tool exists to be called BEFORE the write, so a partial and the page that calls it
     * arriving together as one changeset — neither on disk — is the normal case, not an edge.
     */
    it('reports a caller when NEITHER file is on disk yet', async () => {
      const scan = scanOf({
        [card]: docBuffer,
        'app/views/pages/brand-new.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer, scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        signature_risk: [
          {
            caller: 'app/views/pages/brand-new.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });
  });
});
