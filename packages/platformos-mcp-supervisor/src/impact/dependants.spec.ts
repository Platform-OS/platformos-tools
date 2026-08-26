import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NodeFileSystem,
  path as pathUtils,
  type UriString,
} from '@platformos/platformos-check-node';

import { canHaveDependants, dependantsOf, toDependantBuffers } from './dependants.js';
import { MAX_CANDIDATE_BYTES } from '../cost-model.js';
import { createProjectScan, type ProjectScan } from './project-scan.js';

/**
 * Discovery is an I/O adapter over the project's own text, so these run against a REAL
 * project on disk rather than a stubbed graph.
 *
 * Asserted at discovery's OWN seam rather than through whatever downstream field happens to
 * expose it: the set of files to lint is what discovery owes the diff, and every case below
 * is a way that set can be silently wrong — too wide, too narrow, or too expensive.
 */
describe('dependantsOf', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pos-deps-'));
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

  const uriOf = (relativePath: string): UriString =>
    pathUtils.normalize(pathUtils.toUri(join(projectDir, relativePath)));

  const scanOf = (buffers: Record<string, string> = {}): ProjectScan =>
    createProjectScan(
      pathUtils.normalize(pathUtils.toUri(projectDir)),
      NodeFileSystem,
      new Map(Object.entries(buffers).map(([rel, content]) => [uriOf(rel), content])),
    );

  /** Dependants as project-relative paths, which is what the assertions read best. */
  const find = async (
    target: string,
    name: string,
    scan: ProjectScan = scanOf(),
    exclude: string[] = [],
  ) => {
    const uris = await dependantsOf(scan, uriOf(target), name, new Set(exclude.map(uriOf)));
    if (uris === null) return null;
    const root = pathUtils.normalize(pathUtils.toUri(projectDir));
    return uris.map((uri) => pathUtils.relative(uri, root));
  };

  const card = 'app/views/partials/card.liquid';

  it('finds the files that reference the target, sorted and distinct', async () => {
    write({
      [card]: '<div></div>',
      'app/views/pages/index.liquid': "{% render 'card' %}",
      'app/views/pages/about.liquid': "{% render 'card' %}",
      'app/views/partials/wrapper.liquid': "{% include 'card' %}",
    });

    expect(await find(card, 'card')).toEqual([
      'app/views/pages/about.liquid',
      'app/views/pages/index.liquid',
      'app/views/partials/wrapper.liquid',
    ]);
  });

  it('counts a file ONCE however many times it calls the target', async () => {
    write({
      [card]: '<div></div>',
      'app/views/pages/index.liquid': "{% render 'card' %}{% render 'card' %}{% include 'card' %}",
    });

    expect(await find(card, 'card')).toEqual(['app/views/pages/index.liquid']);
  });

  /**
   * The name filter is an over-approximation, so everything past it must be EXACT. Prose
   * mentioning the name, and a DIFFERENT partial whose name merely starts with it, both
   * survive the filter and must contribute nothing — while the real caller in the same
   * fixture still appears.
   */
  it('excludes a file that only mentions the name without referencing it', async () => {
    write({
      [card]: '<div></div>',
      'app/views/pages/prose.liquid': '<p>the card component is documented elsewhere</p>',
      'app/views/pages/prefix.liquid': "{% render 'card_footer' %}",
      'app/views/partials/card_footer.liquid': '<footer></footer>',
      'app/views/pages/real.liquid': "{% render 'card' %}",
    });

    expect(await find(card, 'card')).toEqual(['app/views/pages/real.liquid']);
  });

  /**
   * EVERY edge kind counts, not just the three whose arguments are `@param`s. The engine
   * decides what is broken; discovery only decides what to look at, and a background or
   * graphql caller can be broken by an edit exactly as a render caller can.
   */
  it('finds callers through background and function edges, not just render/include', async () => {
    write({
      [card]: '<div></div>',
      'app/views/pages/bg.liquid': "{% background job = 'card', delay: 5 %}",
      'app/lib/commands/run.liquid': "{% function r = 'card' %}",
      // A `{% graphql %}` operand names a `.graphql` operation, so this one resolves to
      // `app/graphql/card.graphql` and is NOT a dependant of the partial. Kept in the
      // fixture so the exclusion is measured rather than merely absent.
      'app/views/pages/gql.liquid': "{% graphql g = 'card' %}",
    });

    expect(await find(card, 'card')).toEqual([
      'app/lib/commands/run.liquid',
      'app/views/pages/bg.liquid',
    ]);
  });

  it('finds the caller of a GraphQL operation, whose edge points at the .graphql file', async () => {
    write({
      'app/graphql/get_posts.graphql': 'query { records { results { id } } }',
      'app/views/pages/index.liquid': "{% graphql posts = 'get_posts' %}",
    });

    expect(await find('app/graphql/get_posts.graphql', 'get_posts')).toEqual([
      'app/views/pages/index.liquid',
    ]);
  });

  it('finds a caller in a module, whose reference spells the modules/<name>/ prefix', async () => {
    write({
      'modules/core/public/views/partials/badge.liquid': '<span></span>',
      'app/views/pages/index.liquid': "{% render 'modules/core/badge' %}",
    });

    expect(
      await find('modules/core/public/views/partials/badge.liquid', 'modules/core/badge'),
    ).toEqual(['app/views/pages/index.liquid']);
  });

  it('finds a page that names the target as its frontmatter layout', async () => {
    write({
      'app/views/layouts/application.liquid': '<html>{{ content_for_layout }}</html>',
      'app/views/pages/index.liquid': '---\nlayout: application\n---\n<p>hi</p>',
    });

    expect(await find('app/views/layouts/application.liquid', 'application')).toEqual([
      'app/views/pages/index.liquid',
    ]);
  });

  describe('what must be left OUT of the set', () => {
    /**
     * A file in the changeset is already reported on its own terms. Linting it again as
     * somebody's dependant reports the same finding twice, and — worse — its baseline pass
     * would compare the buffer against itself.
     */
    it('excludes a dependant that is itself in the changeset', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/edited.liquid': "{% render 'card' %}",
        'app/views/pages/untouched.liquid': "{% render 'card' %}",
      });

      expect(await find(card, 'card', scanOf(), ['app/views/pages/edited.liquid'])).toEqual([
        'app/views/pages/untouched.liquid',
      ]);
    });

    it('excludes the target itself, even when it renders itself', async () => {
      write({
        [card]: "{% render 'card' %}",
        'app/views/pages/index.liquid': "{% render 'card' %}",
      });

      expect(await find(card, 'card')).toEqual(['app/views/pages/index.liquid']);
    });

    /**
     * Not a bug to fix but a limit to report: `{% render var %}` resolves at runtime, so no
     * static analysis can see it. The literal caller is the control — the fixture is not
     * silent by accident. `frontier.ts` is what surfaces this gap to the agent.
     */
    it('cannot see a caller that names the target through a variable', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/dynamic.liquid': "{% assign chosen = 'card' %}{% render chosen %}",
        'app/views/pages/literal.liquid': "{% render 'card' %}",
      });

      expect(await find(card, 'card')).toEqual(['app/views/pages/literal.liquid']);
    });

    /**
     * The resolver needs an AST, so a caller that does not PARSE contributes nothing — while
     * one that parses and is merely BROKEN still does. The pair is what keeps the boundary
     * at parseability rather than at health.
     */
    it('cannot see an unparseable caller, but still sees one that merely fails lint', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/unparseable.liquid': "{% render 'card' %}{% if x %}",
        'app/views/pages/lint_broken.liquid': "{% render 'nonexistent' %}{% render 'card' %}",
      });

      expect(await find(card, 'card')).toEqual(['app/views/pages/lint_broken.liquid']);
    });
  });

  describe('the changeset is what counts, not just disk', () => {
    it('finds a caller the changeset has just added', async () => {
      write({ [card]: '<div></div>', 'app/views/pages/index.liquid': '<p>nothing yet</p>' });

      const scan = scanOf({ 'app/views/pages/index.liquid': "{% render 'card' %}" });

      // The buffer is in the changeset, so it is excluded from the dependant SET — its own
      // result reports it. What this proves is that the scan sees the buffer at all.
      expect(await find(card, 'card', scan)).toEqual(['app/views/pages/index.liquid']);
    });

    it('stops finding a caller whose reference the changeset has just deleted', async () => {
      write({
        [card]: '<div></div>',
        'app/views/pages/index.liquid': "{% render 'card' %}",
        'app/views/pages/other.liquid': "{% render 'card' %}",
      });

      const scan = scanOf({ 'app/views/pages/index.liquid': '<p>not any more</p>' });

      expect(await find(card, 'card', scan)).toEqual(['app/views/pages/other.liquid']);
    });
  });
});

/**
 * The name filter is what makes discovery affordable, and NO correctness test can catch its
 * removal: deleting it parses every edge source and returns the same answer, only slowly.
 * So the claim is a cost, and it is measured with its own control — the SAME code, the same
 * project, the same single caller, differing only in how many files survive the filter. A
 * distinctive name leaves one candidate; a name every file happens to contain leaves all of
 * them. Delete the filter and the two collapse to the same number, failing this.
 */
describe('dependantsOf keeps the project affordable', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pos-deps-cost-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('parses only the files that could name the target, not the project', async () => {
    const FILES = 300;
    const write = (rel: string, body: string) => {
      const absolute = join(projectDir, rel);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body, 'utf8');
    };

    write('app/views/partials/zqx_rare.liquid', '<div></div>');
    write('app/views/partials/item.liquid', '<div></div>');
    for (let i = 0; i < FILES; i++) {
      // Every filler file contains "item" and not "zqx_rare", so the two targets below see
      // the same project and a wildly different candidate count.
      write(`app/views/pages/p${i}.liquid`, `<div class="item">item ${i}</div>`);
    }
    write('app/views/pages/caller_rare.liquid', "{% render 'zqx_rare' %}");
    write('app/views/pages/caller_item.liquid', "{% render 'item' %}");

    const rootUri = pathUtils.normalize(pathUtils.toUri(projectDir));
    const uriOf = (rel: string) => pathUtils.normalize(pathUtils.toUri(join(projectDir, rel)));

    const elapsed = async (target: string, name: string) => {
      // A fresh scan each time so the project READ is paid by both and only the candidate
      // parsing differs; warmed once so neither pays for a cold JIT.
      const once = () =>
        dependantsOf(
          createProjectScan(rootUri, NodeFileSystem),
          uriOf(target),
          name,
          new Set<UriString>(),
        );
      await once();
      const started = performance.now();
      await once();
      return performance.now() - started;
    };

    const rare = await elapsed('app/views/partials/zqx_rare.liquid', 'zqx_rare');
    const common = await elapsed('app/views/partials/item.liquid', 'item');

    expect(rare * 3 < common).toBe(true);
  }, 120_000);
});

/**
 * Discovery's own bound, and the reason it exists: parsing is what discovery COSTS, and the
 * most-referenced file on a real 2,615-file application cost 4.7 s and then returned
 * `unavailable` regardless. The candidate byte total is known from the substring scan
 * already done, so the same answer is reachable before a single parse.
 *
 * `null` is "not looked at", never "no dependants" — the caller reports it as `unavailable`.
 */
describe('dependantsOf refuses work it cannot finish', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pos-deps-bound-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const build = (fillerBytes: number) => {
    const write = (rel: string, body: string) => {
      const absolute = join(projectDir, rel);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body, 'utf8');
    };
    write('app/views/partials/card.liquid', '<div></div>');
    write('app/views/pages/real.liquid', "{% render 'card' %}");
    // Files that MENTION the name without calling it, so they are candidates and nothing
    // more — the byte total is what decides, not the dependant count.
    for (let i = 0; i < 8; i += 1) {
      write(`app/views/pages/filler${i}.liquid`, `<!-- card -->${'x'.repeat(fillerBytes)}`);
    }
    return createProjectScan(
      pathUtils.normalize(pathUtils.toUri(projectDir)),
      NodeFileSystem,
      new Map(),
    );
  };

  const uriOf = (rel: string) => pathUtils.normalize(pathUtils.toUri(join(projectDir, rel)));

  it('returns null rather than parsing more candidate text than the bound allows', async () => {
    const scan = build(Math.ceil(MAX_CANDIDATE_BYTES / 4));

    expect(
      await dependantsOf(scan, uriOf('app/views/partials/card.liquid'), 'card', new Set()),
    ).toBeNull();
  });

  /**
   * CONTROL. Same fixture, same candidate COUNT, only the size differs — so the bound is
   * proven to turn on bytes rather than on something incidental, and the small case really
   * does find the dependant it should.
   */
  it('CONTROL: the same candidate count under the bound is examined normally', async () => {
    const scan = build(16);
    const root = pathUtils.normalize(pathUtils.toUri(projectDir));

    const found = await dependantsOf(
      scan,
      uriOf('app/views/partials/card.liquid'),
      'card',
      new Set(),
    );

    expect(found?.map((uri) => pathUtils.relative(uri, root))).toEqual([
      'app/views/pages/real.liquid',
    ]);
  });
});

/**
 * The cheapest question impact asks, and the one that decides whether the project is read at
 * all. Both of its conditions are separated here, because a single false answer hides which
 * one produced it — and they mean different things: "the graph cannot model dependants for
 * this KIND of file" is a permanent architectural fact (ADR 004, TASK-95), while "this file
 * has no name to reference" is a property of where it sits.
 */
describe('canHaveDependants', () => {
  const ROOT = pathUtils.normalize(pathUtils.toUri('/srv/app'));
  const at = (relativePath: string) =>
    canHaveDependants(pathUtils.normalize(pathUtils.toUri(`/srv/app/${relativePath}`)), ROOT);

  it('accepts the file types that can be a resolvable edge TARGET', () => {
    expect([
      at('app/views/partials/card.liquid'),
      at('app/views/layouts/application.liquid'),
      at('app/graphql/get_users.graphql'),
    ]).toEqual([true, true, true]);
  });

  /**
   * YAML is excluded on purpose. A schema, model type or translation file is wired by NAME
   * (ADR 004), so the graph holds no edge to it and asking would answer "nothing depends on
   * this" — the exact false clearance this whole design exists to avoid. Giving those files
   * real dependants is TASK-95, in the graph rather than here.
   */
  it('rejects YAML and assets, which have no edges pointing at them however many files use them', () => {
    expect([
      at('app/translations/en.yml'),
      at('app/custom_model_types/blog_post.yml'),
      at('app/assets/logo.png'),
    ]).toEqual([false, false, false]);
  });

  it('rejects a Liquid file in no platformOS directory — nothing can spell its name', () => {
    expect([at('scripts/generate.liquid'), at('README.liquid')]).toEqual([false, false]);
  });
});

describe('toDependantBuffers', () => {
  it('reads each dependant from the scan rather than going back to disk', () => {
    const a = pathUtils.normalize(pathUtils.toUri('/srv/app/app/views/pages/a.liquid'));
    const b = pathUtils.normalize(pathUtils.toUri('/srv/app/app/views/pages/b.liquid'));
    const sources = new Map([
      [a, 'A text'],
      [b, 'B text'],
    ]);

    expect(toDependantBuffers([a, b], sources).map((buffer) => buffer.content)).toEqual([
      'A text',
      'B text',
    ]);
  });

  /**
   * Unreachable — every dependant came out of this map — but the fallback matters: linting a
   * missing file as EMPTY text makes every finding it had look newly caused by the change.
   */
  it('drops a URI the scan does not hold rather than linting it as empty', () => {
    const known = pathUtils.normalize(pathUtils.toUri('/srv/app/app/views/pages/a.liquid'));
    const missing = pathUtils.normalize(pathUtils.toUri('/srv/app/app/views/pages/gone.liquid'));

    expect(toDependantBuffers([known, missing], new Map([[known, 'A text']]))).toHaveLength(1);
  });
});
