/**
 * The whole pipeline, over a realistic project, end to end.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { runBatchLint } from '../../src/lint/lint-batch.js';
import { BROKEN_PROJECT, ORDINARY_PROJECT, type ProjectTree } from './sweep-projects.js';

const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a {@link ProjectTree} to a fresh temp directory.
 *
 * `join` turns the tree's POSIX keys into whatever the OS spells; the keys themselves stay
 * forward-slashed, and it is the KEYS the sweep hands to the lint and the keys the
 * expectations are written in. That is why the corpus is a literal — a discovered corpus
 * reaches the assertions in the filesystem's spelling, which is how this spec once passed
 * on Linux and failed on Windows with an identical set of findings.
 */
function materialize(tree: ProjectTree): string {
  const root = mkdtempSync(join(tmpdir(), 'mcp-supervisor-sweep-'));
  workspaces.push(root);
  for (const [file, content] of Object.entries(tree)) {
    const absolute = join(root, file);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  return root;
}

interface SweepResult {
  findings: string[];
  refused: string[];
  unanswered: string[];
}

/**
 * One sweep per tree, however many assertions read it.
 *
 * Memoized on the tree itself rather than per `it`, because a sweep writes 45 files and runs
 * the whole pipeline over them. The assertions read disjoint fields of the same whole-value
 * answer, so nothing here lets one test observe another's state.
 */
const sweeps = new Map<ProjectTree, Promise<SweepResult>>();
function sweep(tree: ProjectTree): Promise<SweepResult> {
  const existing = sweeps.get(tree);
  if (existing) return existing;

  const pending = runSweep(tree);
  sweeps.set(tree, pending);
  return pending;
}

/**
 * Lint EVERY file of a project tree and reduce it to sorted `file :: check (severity)` —
 * plus, per file the lint declined, `file :: status`.
 */
async function runSweep(tree: ProjectTree): Promise<SweepResult> {
  const root = materialize(tree);
  const files = Object.keys(tree).sort();
  const { diagnostics, notChecked } = await runBatchLint({
    projectDir: root,
    buffers: files.map((file) => ({ filePath: file, content: tree[file] })),
  });

  // A file in NEITHER map is the fail-safe case the orchestrator turns into
  // `internal_error`; it must not happen for an ordinary project.
  const unanswered = files.filter((file) => !diagnostics.has(file) && !notChecked.has(file));

  const findings = [...diagnostics].flatMap(([file, found]) =>
    found.map((d) => `${file} :: ${d.check} (${d.severity})`),
  );
  const refused = [...notChecked].map(([file, status]) => `${file} :: ${status}`);
  return { findings: findings.sort(), refused: refused.sort(), unanswered };
}

describe('Integration: the real pipeline over a deliberately broken project', () => {
  /**
   * A file the platform will never load is DECLINED, with the status that says WHICH kind —
   * not linted, and not passed either. The three are genuinely different answers and an
   * agent acts differently on each:
   */
  it('declines a file the platform will never load, and says which kind', async () => {
    const { refused } = await sweep(BROKEN_PROJECT);

    expect(refused).toEqual([
      '.pos :: not-a-platformos-file',
      'app/assets/inline_widget.liquid :: not-a-source-file',
      'lib/helpers/misplaced_partial.liquid :: misplaced-source',
    ]);
  }, 120_000);

  it('answers for every file and reports exactly these findings', async () => {
    const { findings, unanswered } = await sweep(BROKEN_PROJECT);

    expect(unanswered).toEqual([]);
    expect(findings).toEqual([
      'app/graphql/errors/bad_query.graphql :: GraphQLCheck (error)',
      'app/graphql/errors/bad_query.graphql :: GraphQLCheck (error)',
      'app/graphql/errors/bad_query.graphql :: GraphQLCheck (error)',
      'app/graphql/errors/bad_query.graphql :: GraphQLCheck (error)',
      'app/graphql/errors/bad_query.graphql :: GraphQLCheck (error)',
      'app/graphql/products/search.graphql :: GraphQLCheck (error)',
      'app/lib/commands/products/create/check.liquid :: FilterArity (error)',
      'app/lib/commands/products/create/main.liquid :: MissingPartial (error)',
      'app/lib/commands/products/delete/main.liquid :: UnusedDocParam (warning)',
      'app/lib/commands/products/update/main.liquid :: UnusedAssign (warning)',
      'app/lib/commands/products/update/main.liquid :: UnusedDocParam (warning)',
      'app/lib/queries/products/search.liquid :: RequiredDocParamWithDefault (warning)',
      'app/lib/queries/products/search.liquid :: RequiredDocParamWithDefault (warning)',
      'app/views/pages/admin/dashboard.html.liquid :: MissingPartial (error)',
      'app/views/pages/admin/dashboard.html.liquid :: MissingRenderPartialArguments (error)',
      'app/views/pages/admin/dashboard.html.liquid :: MissingRenderPartialArguments (error)',
      'app/views/pages/admin/dashboard.html.liquid :: MissingRenderPartialArguments (error)',
      'app/views/pages/admin/dashboard.html.liquid :: UnknownProperty (error)',
      'app/views/pages/errors/bad_layout.html.liquid :: MissingLayout (error)',
      'app/views/pages/errors/bad_layout.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/errors/bad_layout.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/errors/bad_method.html.liquid :: InvalidFrontmatterValue (error)',
      'app/views/pages/errors/bad_method.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/errors/bad_method.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/products/bad_page.html.liquid :: UndefinedObject (warning)',
      'app/views/pages/products/index.html.liquid :: MissingPartial (error)',
      'app/views/pages/products/invalid_fm.html.liquid :: MissingRenderPartialArguments (error)',
      'app/views/pages/products/invalid_fm.html.liquid :: UnknownFrontmatterField (error)',
      'app/views/pages/products/invalid_fm.html.liquid :: UnknownFrontmatterField (error)',
      'app/views/pages/products/invalid_fm.html.liquid :: UnknownFrontmatterField (error)',
      'app/views/pages/products/unused.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/products/unused.html.liquid :: PartialCallArguments (error)',
      'app/views/pages/products/unused.html.liquid :: UnusedAssign (warning)',
      'app/views/pages/products/unused.html.liquid :: UnusedAssign (warning)',
      'app/views/partials/errors/bad_hash_assign.liquid :: DeprecatedTag (warning)',
      'app/views/partials/errors/bad_hash_assign.liquid :: DeprecatedTag (warning)',
      'app/views/partials/errors/bad_hash_assign.liquid :: LiquidHTMLSyntaxError (error)',
      'app/views/partials/errors/bad_images.liquid :: ImgWidthAndHeight (error)',
      'app/views/partials/errors/bad_images.liquid :: ImgWidthAndHeight (error)',
      'app/views/partials/errors/hardcoded_routes.liquid :: MissingPage (warning)',
      'app/views/partials/errors/hardcoded_routes.liquid :: MissingPage (warning)',
      'app/views/partials/errors/missing_asset.liquid :: MissingAsset (error)',
      'app/views/partials/errors/missing_asset.liquid :: MissingAsset (error)',
      'app/views/partials/errors/missing_asset.liquid :: ParserBlockingScript (error)',
      'app/views/partials/errors/missing_asset.liquid :: UnusedDocParam (warning)',
      'app/views/partials/errors/nested_graphql.liquid :: NestedGraphQLQuery (warning)',
      'app/views/partials/errors/nested_graphql.liquid :: UnusedDocParam (warning)',
      'app/views/partials/errors/syntax_error.liquid :: LiquidHTMLSyntaxError (error)',
      'app/views/partials/errors/unused_params.liquid :: UnusedDocParam (warning)',
      'app/views/partials/errors/unused_params.liquid :: UnusedDocParam (warning)',
      'app/views/partials/products/bad_filters.liquid :: UnknownFilter (error)',
      'app/views/partials/products/bad_filters.liquid :: UnknownFilter (error)',
      'app/views/partials/products/bad_filters.liquid :: UnknownFilter (error)',
      'app/views/partials/products/caller.liquid :: MissingRenderPartialArguments (error)',
      'app/views/partials/products/deprecated_patterns.liquid :: DeprecatedTag (warning)',
      'app/views/partials/products/deprecated_patterns.liquid :: DeprecatedTag (warning)',
      'app/views/partials/products/shopify_contaminated.liquid :: MissingDocParam (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: MissingDocParam (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: MissingDocParam (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: MissingDocParam (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: UnknownFilter (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: UnknownFilter (error)',
      'app/views/partials/products/shopify_contaminated.liquid :: UnusedDocParam (warning)',
      'app/views/partials/products/undef_vars.liquid :: MissingDocParam (error)',
      'app/views/partials/products/undef_vars.liquid :: MissingDocParam (error)',
      'app/views/partials/products/undef_vars.liquid :: MissingDocParam (error)',
      'modules/user/public/views/partials/lib/helpers/can_do_or_redirect.liquid :: UnusedDocParam (warning)',
    ]);
  }, 120_000);
});

/**
 * The same sweep over an ORDINARY project — one written to work rather than to break.
 */
describe('Integration: the real pipeline over an ordinary project', () => {
  it('answers for every file and reports exactly these findings', async () => {
    const { findings, refused, unanswered } = await sweep(ORDINARY_PROJECT);

    expect(unanswered).toEqual([]);
    // THE CONTROL for the refusals above. A project whose files are all where they belong
    // still declines the two that are not sources — and declines nothing as
    // `misplaced-source`. Without this, a classifier that called EVERYTHING misplaced
    // would satisfy the broken project's expectation and go entirely unnoticed.
    expect(refused).toEqual([
      '.pos :: not-a-platformos-file',
      'app/assets/styles/app.css :: not-a-source-file',
    ]);
    expect(findings).toEqual([
      'app/lib/commands/blog_posts/create/check.liquid :: FilterArity (error)',
      'app/lib/commands/blog_posts/delete/check.liquid :: FilterArity (error)',
      'app/views/pages/blog_posts/index.html.liquid :: MissingRenderPartialArguments (error)',
      'app/views/pages/test.html.liquid :: MissingPartial (error)',
      'app/views/pages/test.html.liquid :: MissingPartial (error)',
      'app/views/pages/test.html.liquid :: TranslationKeyExists (error)',
      'app/views/partials/blog_posts/list.liquid :: MissingRenderPartialArguments (error)',
    ]);
  }, 120_000);
});
