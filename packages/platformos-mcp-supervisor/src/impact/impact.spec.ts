import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystem, path as pathUtils } from '@platformos/platformos-check-node';

import { runImpact } from './impact.js';
import { createProjectScan, type ProjectScan } from './project-scan.js';

/**
 * The blast radius is an I/O adapter over the project's own text, so these run against a
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

  const run = (filePath: string, content = '', scan: ProjectScan = scanOf()) =>
    runImpact({ projectDir, filePath, content }, scan);

  const card = 'app/views/partials/card.liquid';

  describe('dependents', () => {
    it('summarizes distinct dependent files, per-kind counts, and a sorted sample', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/index.liquid': "{% render 'card' %}",
        'app/views/pages/about.liquid': "{% render 'card' %}",
        'app/views/partials/wrapper.liquid': "{% include 'card' %}",
      });

      expect(await run(card)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 3,
          by_kind: { render: 2, include: 1 },
          sample: [
            'app/views/pages/about.liquid',
            'app/views/pages/index.liquid',
            'app/views/partials/wrapper.liquid',
          ],
        },
      });
    });

    it('reports computed with zero dependents (safe to change), distinct from "not computed"', async () => {
      write({ [card]: '<div></div>', 'app/views/pages/index.liquid': '<p>nothing here</p>' });

      expect(await run(card)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: { total: 0, by_kind: {}, sample: [] },
      });
    });

    it('counts a file once in total but under each kind it references by', async () => {
      write({
        [card]: '<div></div>',
        // same caller, two render edges → one distinct file
        'app/views/pages/index.liquid': "{% render 'card' %}{% render 'card' %}",
        // a caller that both renders and includes → one file, counted in both kinds
        'app/views/partials/dual.liquid': "{% render 'card' %}{% include 'card' %}",
      });

      expect(await run(card)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 2,
          by_kind: { render: 2, include: 1 },
          sample: ['app/views/pages/index.liquid', 'app/views/partials/dual.liquid'],
        },
      });
    });

    it('caps the sample at 10 files while keeping the true total', async () => {
      write({
        [card]: '<div></div>',
        ...Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [
            `app/views/pages/p${String(i).padStart(2, '0')}.liquid`,
            "{% render 'card' %}",
          ]),
        ),
      });

      expect(await run(card)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 15,
          by_kind: { render: 15 },
          sample: [
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
          ],
        },
      });
    });

    /**
     * The name filter is an over-approximation, so everything past it must be
     * EXACT. A file that merely spells the name — in prose, or as the prefix of a
     * different partial's name — survives the filter and must contribute nothing.
     */
    it('does not count a file that only mentions the name without referencing it', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/prose.liquid': '<p>the card component is documented elsewhere</p>',
        'app/views/pages/prefix.liquid': "{% render 'card_footer' %}",
        'app/views/partials/card_footer.liquid': '<footer></footer>',
        'app/views/pages/real.liquid': "{% render 'card' %}",
      });

      expect(await run(card)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { render: 1 },
          sample: ['app/views/pages/real.liquid'],
        },
      });
    });

    it('finds callers through every edge kind, not just render/include', async () => {
      write({
        'app/graphql/get_posts.graphql': 'query { posts { id } }',
        'app/views/pages/index.liquid': "{% graphql posts = 'get_posts' %}",
      });

      expect(await run('app/graphql/get_posts.graphql')).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { graphql: 1 },
          sample: ['app/views/pages/index.liquid'],
        },
      });
    });

    it('finds a caller in a module, whose reference spells the modules/<name>/ prefix', async () => {
      write({
        'modules/core/public/views/partials/badge.liquid': '<span></span>',
        'app/views/pages/index.liquid': "{% render 'modules/core/badge' %}",
      });

      expect(await run('modules/core/public/views/partials/badge.liquid')).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { render: 1 },
          sample: ['app/views/pages/index.liquid'],
        },
      });
    });
  });

  describe('the changeset is what counts, not just disk', () => {
    it('counts a caller the buffer has just added', async () => {
      write({ [card]: '<div></div>', 'app/views/pages/index.liquid': '<p>nothing yet</p>' });

      const scan = scanOf({ 'app/views/pages/index.liquid': "{% render 'card' %}" });

      expect(await run(card, '', scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { render: 1 },
          sample: ['app/views/pages/index.liquid'],
        },
      });
    });

    it('stops counting a caller whose reference the buffer has just deleted', async () => {
      write({ [card]: '<div></div>', 'app/views/pages/index.liquid': "{% render 'card' %}" });

      const scan = scanOf({ 'app/views/pages/index.liquid': '<p>not any more</p>' });

      expect(await run(card, '', scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: { total: 0, by_kind: {}, sample: [] },
      });
    });

    it('counts a caller that does not exist on disk at all yet', async () => {
      write({ [card]: '<div></div>' });

      const scan = scanOf({ 'app/views/pages/brand-new.liquid': "{% render 'card' %}" });

      expect(await run(card, '', scan)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { render: 1 },
          sample: ['app/views/pages/brand-new.liquid'],
        },
      });
    });
  });

  describe('applicability (files nothing can reference by name)', () => {
    /**
     * A scan that throws if it is consulted — applicability is a property of the
     * FILE, decided before any project text is read.
     */
    const throwingScan = (): ProjectScan => ({
      rootUri: pathUtils.normalize(pathUtils.toUri(projectDir)),
      fs: NodeFileSystem,
      sources: () => {
        throw new Error('the project must not be scanned for a non-trackable file');
      },
    });

    it('reports not_applicable for a custom-model-type/schema YAML (wired by table name, not by edge)', async () => {
      expect(await run('app/custom_model_types/blog_post.yml', '', throwingScan())).toEqual({
        scope: 'direct',
        status: 'not_applicable',
        dependents: { total: 0, by_kind: {}, sample: [] },
      });
    });

    it('reports not_applicable for a translation YAML', async () => {
      expect(await run('app/translations/en.yml', '', throwingScan())).toEqual({
        scope: 'direct',
        status: 'not_applicable',
        dependents: { total: 0, by_kind: {}, sample: [] },
      });
    });

    it('reports not_applicable for a Liquid file in no platformOS directory — it has no name to reference', async () => {
      expect(await run('scripts/generate.liquid', '', throwingScan())).toEqual({
        scope: 'direct',
        status: 'not_applicable',
        dependents: { total: 0, by_kind: {}, sample: [] },
      });
    });
  });

  describe('signature-impact (callers vs the edited buffer {% doc %})', () => {
    // A buffer declaring `title` (required) and `count` (optional).
    const docBuffer = `{% doc %}
  @param {String} title - required title
  @param {Number} [count] - optional count
{% enddoc %}
<div>{{ title }}</div>`;

    it('flags dependent callers that omit a required @param or pass an undeclared one', async () => {
      write({
        [card]: '<div></div>',
        // ok: passes the required title
        'app/views/pages/ok.liquid': "{% render 'card', title: 'a', count: 1 %}",
        // missing required `title`
        'app/views/pages/missing.liquid': "{% render 'card', count: 1 %}",
        // passes an argument the doc does not declare
        'app/views/pages/extra.liquid': "{% render 'card', title: 'a', colour: 'red' %}",
        // passes nothing at all → missing required `title`
        'app/views/pages/bare.liquid': "{% render 'card' %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 4,
          by_kind: { render: 4 },
          sample: [
            'app/views/pages/bare.liquid',
            'app/views/pages/extra.liquid',
            'app/views/pages/missing.liquid',
            'app/views/pages/ok.liquid',
          ],
        },
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

    it('returns an empty signature_risk (checked, all match) when every caller satisfies the doc', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/a.liquid': "{% render 'card', title: 'a' %}",
        'app/views/pages/b.liquid': "{% render 'card', title: 'b', count: 2 %}",
      });

      expect((await run(card, docBuffer)).signature_risk).toEqual([]);
    });

    it('omits signature_risk entirely when the buffer declares no {% doc %} contract', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/x.liquid': "{% render 'card', whatever: 1 %}",
      });

      const result = await run(card, '<div>{{ title }}</div>');
      expect(result.signature_risk).toBeUndefined();
      expect(result.status).toEqual('computed');
    });

    it('ignores non-@param edges (background/graphql) — only render/include/function args are @params', async () => {
      write({
        [card]: '<div></div>',
        // render caller passing an undeclared arg → flagged
        'app/views/pages/render.liquid': "{% render 'card', title: 'a', colour: 'red' %}",
        // background caller: `delay` is a scheduling arg, NOT a @param → must NOT be flagged
        'app/views/pages/bg.liquid': "{% background job = 'card', delay: 5 %}",
        // graphql caller: `per_page` is an operation arg, NOT a @param → must NOT be flagged
        'app/views/pages/gql.liquid': "{% graphql g = 'card', per_page: 10 %}",
      });

      // background/graphql callers ARE still counted as dependents — they are only
      // excluded from the @param signature check.
      const result = await run(card, docBuffer);
      expect(result.dependents.by_kind).toEqual({ render: 1, background: 1 });
      expect(result.signature_risk).toEqual([
        {
          caller: 'app/views/pages/render.liquid',
          missing_required: [],
          unexpected_args: ['colour'],
        },
      ]);
    });

    it('includes function call sites (their args ARE @params, mirroring PartialCallArguments)', async () => {
      write({
        [card]: '<div></div>',
        'app/lib/commands/run.liquid': "{% function r = 'card', count: 1 %}",
      });

      expect(await run(card, docBuffer)).toEqual({
        scope: 'direct',
        status: 'computed',
        dependents: {
          total: 1,
          by_kind: { function: 1 },
          sample: ['app/lib/commands/run.liquid'],
        },
        signature_risk: [
          {
            caller: 'app/lib/commands/run.liquid',
            missing_required: ['title'],
            unexpected_args: [],
          },
        ],
      });
    });
  });
});
